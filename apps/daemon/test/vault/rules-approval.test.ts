import { afterEach, describe, expect, test } from "bun:test";
import { REQUEST_TTL_MS } from "../../src/actions/actions.ts";
import {
  allow,
  echoDef,
  failure,
  NOW,
  runCleanups,
  setup,
  VALUE,
} from "../support/rules-approval.ts";

afterEach(runCleanups);

describe("regras-aprovacao: o pedido leva o que as regras decidiram", () => {
  test("sem regra o padrão pergunta uma vez por sessão, e o frame diz o porquê e até quando vale", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["staging"] }) });
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({
      requester: "claude",
      action: "echo",
      decision: "ask",
      ruleId: null,
      once: true,
      needsHold: false,
      tags: ["staging"],
      expiresAt: NOW + 3000,
    });
    expect(f.reason).toContain("default");
    t.approveAndDeliver(f);
    expect((await running).output).toBe("•••(token)\n");
    expect(JSON.stringify(t.frames)).not.toContain(VALUE);
  });

  test("o prazo de um pedido sem resposta é de 10 minutos", async () => {
    expect(REQUEST_TTL_MS).toBe(10 * 60_000);
    const t = setup({ requestTimeoutMs: undefined });
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    void t.run().catch(() => {});
    const f = await t.frame();
    expect(f.expiresAt).toBe(NOW + 10 * 60_000);
  });

  test("uma regra allow entrega sem perguntar: o frame diz allow e a regra, e o gate deixa passar", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.setRules([allow()]);
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "allow", ruleId: "liberar", once: false });
    t.actions.gate(f.purpose);
    t.deliver(f);
    expect((await running).output).toBe("•••(token)\n");
  });

  test("a regra vale pelos campos do uso: ação, host, projeto e as tags do segredo", async () => {
    const t = setup({ projectKey: () => "github.com/acme/app" });
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.setRules(
      [
        allow({
          id: "completa",
          match: {
            requester: "claude",
            purpose: "action",
            action: "ec*",
            host: "vps",
            project: "github.com/acme/app",
            tags: ["staging"],
            session: "s1",
          },
        }),
      ],
      ["staging"],
    );
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "allow", ruleId: "completa" });
    t.deliver(f);
    await running;
    // Another session, and the rule does not apply.
    const other = t.run({ session: "s2" });
    const g = await t.frame(1);
    expect(g).toMatchObject({ decision: "ask", ruleId: null });
    t.approveAndDeliver(g);
    await other;
  });
});

describe("regras-aprovacao: o que a regra nega não chega ao app", () => {
  test("deny por regra falha na hora, sem frame e sem precisar do app conectado", async () => {
    const t = setup({}, false);
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.setRules([{ id: "nada", decision: "deny" }]);
    const error = await failure(t.run());
    expect(error).toContain("invalid_state");
    expect(error).toContain("nada");
    expect(t.requests()).toEqual([]);
  });

  test("automação e workflow: o padrão nega sem frame; uma regra pode liberar", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    for (const requestedBy of ["automation", "workflow"] as const) {
      const error = await failure(t.run({ requestedBy }));
      expect(error).toContain("invalid_state");
      expect(error).toContain(requestedBy);
    }
    expect(t.requests()).toEqual([]);
    t.setRules([allow({ id: "auto", match: { requester: "automation" } })]);
    const running = t.run({ requestedBy: "automation" });
    const f = await t.frame();
    expect(f).toMatchObject({ requester: "automation", decision: "allow", ruleId: "auto" });
    t.deliver(f);
    await running;
  });
});

describe("regras-aprovacao: aprovar", () => {
  test("o gate recusa a entrega de um pedido que pergunta até ele ser aprovado, e deixa passar o resto", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const running = t.run();
    const f = await t.frame();
    const refused = await failure(Promise.resolve().then(() => t.actions.gate(f.purpose)));
    expect(refused).toContain("invalid_state");
    expect(refused).toContain("[action_needs_approval]");
    // Deliveries that are not for a request of the daemon are not its business.
    t.actions.gate("action:echo:you");
    t.actions.gate("ssh:qualquer");
    t.actions.gate("action:echo:ULID-QUE-NAO-EXISTE");
    t.approveAndDeliver(f);
    await running;
    // The request is over: nothing waits for it any more.
    t.actions.gate(f.purpose);
  });

  test("aprovar o que não existe é not_found; o que já é allow não precisa; aprovar de novo não faz mal", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    expect(
      await failure(Promise.resolve().then(() => t.actions.approve("nada", { via: "app" }))),
    ).toContain("not_found");
    t.setRules([allow()]);
    const free = t.run();
    const g = await t.frame();
    expect(
      await failure(Promise.resolve().then(() => t.actions.approve(g.requestId, { via: "app" }))),
    ).toContain("[action_no_approval_needed]");
    t.deliver(g);
    await free;

    t.setRules([]);
    const asked = t.run();
    const f = await t.frame(1);
    t.actions.approve(f.requestId, { via: "app" });
    t.actions.approve(f.requestId, { via: "app" });
    t.deliver(f);
    await asked;
  });

  test("aprovar e não perguntar mais nesta sessão: a mesma sessão passa, outra pergunta", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const first = t.run();
    t.approveAndDeliver(await t.frame(0), { via: "app", scope: "session" });
    await first;

    const second = t.run();
    const g = await t.frame(1);
    expect(g).toMatchObject({ decision: "allow", ruleId: null });
    expect(g.reason).toContain("already approved in this session");
    t.actions.gate(g.purpose);
    t.deliver(g);
    await second;

    const other = t.run({ session: "s2" });
    const h = await t.frame(2);
    expect(h.decision).toBe("ask");
    t.approveAndDeliver(h);
    await other;

    // Approving once does not carry over to the next use.
    const again = t.run({ session: "s2" });
    expect((await t.frame(3)).decision).toBe("ask");
    t.approveAndDeliver(await t.frame(3));
    await again;
  });

  test("o aprovado na sessão vale para o segredo e a regra dele, não para outro segredo", async () => {
    const t = setup();
    await t.actions.save({
      projectId: "p1",
      definition: {
        name: "dois",
        description: "dois segredos",
        run: [process.execPath, "-e", "console.log(process.env.A, process.env.B)"],
        env: { A: "{{secret.token}}", B: "{{secret.zeta}}" },
      },
    });
    const first = t.run({ name: "dois" });
    const a = await t.frame(0);
    t.approveAndDeliver(a, { via: "app", scope: "session" });
    const b = await t.frame(1);
    expect(b.secretId).toBe("zeta");
    t.approveAndDeliver(b, { via: "app", scope: "once" });
    await first;

    const second = t.run({ name: "dois" });
    expect((await t.frame(2)).decision).toBe("allow");
    t.deliver(await t.frame(2));
    const c = await t.frame(3);
    expect(c.decision).toBe("ask");
    t.approveAndDeliver(c);
    await second;
  });

  test("aprovar para a sessão só quando a regra permite: ask a cada uso não deixa", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ approval: "always" }) });
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "ask", once: false });
    const error = await failure(
      Promise.resolve().then(() =>
        t.actions.approve(f.requestId, { via: "app", scope: "session" }),
      ),
    );
    expect(error).toContain("invalid_state");
    expect(error).toContain("[action_session_refused_rule]");
    t.approveAndDeliver(f);
    await running;

    // A rule with once: session does allow it.
    t.setRules([{ id: "sessao", decision: "ask", once: "session" }]);
    const ruled = t.run();
    const g = await t.frame(1);
    expect(g).toMatchObject({ once: true, ruleId: "sessao" });
    t.approveAndDeliver(g, { via: "app", scope: "session" });
    await ruled;
  });

  test("sem sessão informada o aprovado na sessão não é lembrado", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const first = t.run({ session: undefined });
    t.approveAndDeliver(await t.frame(0), { via: "app", scope: "session" });
    await first;
    const second = t.run({ session: undefined });
    expect((await t.frame(1)).decision).toBe("ask");
    t.approveAndDeliver(await t.frame(1));
    await second;
  });

  test("recusar pelo vault.deny termina o pedido, que deixa de existir para aprovar", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const running = failure(t.run());
    const f = await t.frame();
    t.actions.deny(f.requestId);
    expect(await running).toContain("[action_secret_refused]");
    expect(
      await failure(Promise.resolve().then(() => t.actions.approve(f.requestId, { via: "app" }))),
    ).toContain("not_found");
  });
});
