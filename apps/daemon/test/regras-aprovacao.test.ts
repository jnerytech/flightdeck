import { afterEach, describe, expect, test } from "bun:test";
import type { VaultAlertFrame, VaultRequestFrame, VaultUsed } from "@flightdeck/protocol";
import {
  Actions,
  type ActionsFrame,
  type ActionsOptions,
  REQUEST_TTL_MS,
} from "../src/actions/actions.ts";
import type { FlightdeckError } from "../src/errors.ts";
import { EventStore } from "../src/store/event-store.ts";
import type { Rule } from "../src/vault/rules.ts";
import { VaultRules } from "../src/vault/rules-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { gitRepo } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";

const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";
/** Wednesday 2026-10-28, 12:00 in São Paulo (UTC-3, no daylight time). */
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
const HOUR = 3_600_000;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const echoDef = (over: Record<string, unknown> = {}) => ({
  name: "echo",
  description: "imprime o token",
  run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
  env: { TOKEN: "{{secret.token}}" },
  ...over,
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return `${(error as FlightdeckError).code}: ${(error as Error).message}`;
  }
};

function setup(over: Partial<ActionsOptions> = {}, watching = true) {
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const rules = new VaultRules();
  const now = { at: NOW };
  const actions = new Actions({
    db: store.db,
    vault,
    rules,
    hostName: "vps",
    hostBase: tempDir("fd-host-"),
    timeZone: "America/Sao_Paulo",
    clock: () => now.at,
    requestTimeoutMs: 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
    ...over,
  });
  const frames: ActionsFrame[] = [];
  const unwatch = watching ? actions.watch((frame) => frames.push(frame)) : () => {};
  cleanups.push(() => {
    unwatch();
    actions.stop();
    vault.stop();
  });
  const requests = () => frames.filter((f): f is VaultRequestFrame => f.type === "vault.request");
  const alerts = () => frames.filter((f): f is VaultAlertFrame => f.type === "vault.alert");
  const used = () => frames.filter((f): f is VaultUsed => f.type === "vault.used");
  const deliver = (frame: { secretId: string; purpose: string }) =>
    vault.deliver(
      {
        secretId: frame.secretId,
        value: VALUE,
        purpose: frame.purpose,
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      },
      "127.0.0.1",
    );
  const run = (input: Record<string, unknown> = {}) =>
    actions.run({
      projectId: "p1",
      name: "echo",
      requestedBy: "claude",
      session: "s1",
      ...input,
    } as Parameters<Actions["run"]>[0]);
  /** The nth request frame, once it arrives. */
  const frame = async (n = 0) => (await poll(() => requests()[n])) as VaultRequestFrame;
  /** What the app does for an approval: approve, then deliver the secret. */
  const approveAndDeliver = (
    f: VaultRequestFrame,
    approval: Parameters<Actions["approve"]>[1] = { via: "app", heldMs: 0 },
  ) => {
    actions.approve(f.requestId, approval);
    actions.gate(f.purpose);
    deliver(f);
  };
  const setRules = (list: unknown[], tags: string[] = []) => rules.set("token", tags, list);
  return {
    actions,
    vault,
    rules,
    store,
    now,
    frames,
    requests,
    alerts,
    used,
    deliver,
    run,
    frame,
    approveAndDeliver,
    setRules,
  };
}

const allow = (over: Record<string, unknown> = {}) => ({
  id: "liberar",
  match: { requester: "claude" },
  decision: "allow",
  ...over,
});

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
    expect(f.reason).toContain("padrão");
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
    expect(refused).toContain("aprovação");
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
    ).toContain("não precisa");
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
    expect(g.reason).toContain("sessão");
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
    expect(error).toContain("sessão");
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
    expect(await running).toContain("recusou");
    expect(
      await failure(Promise.resolve().then(() => t.actions.approve(f.requestId, { via: "app" }))),
    ).toContain("not_found");
  });
});

describe("regras-aprovacao: prod e risco alto", () => {
  test("an ssh action on a destino tagged prod, and a free command there, ask at every use, held, though neither the action nor the secret says prod", async () => {
    const t = setup({
      ssh: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      sshTags: (target: string) => (target === "prod-api" ? ["prod"] : []),
    });
    await t.actions.save({
      projectId: "p1",
      definition: echoDef({ ssh: "prod-api", run: ["uptime"] }),
    });
    const action = t.run();
    const a = await t.frame(0);
    expect(a).toMatchObject({ decision: "ask", once: false, needsHold: true });
    t.approveAndDeliver(a, { via: "app", heldMs: 2000 });
    await action;
    const free = t.actions.runFree({
      command: "uptime",
      secrets: ["token"],
      host: "prod-api",
      requestedBy: "claude",
    });
    const b = await t.frame(1);
    expect(b).toMatchObject({ decision: "ask", needsHold: true });
    t.approveAndDeliver(b, { via: "app", heldMs: 2000 });
    await free;
  });

  test("a session approval of a use that is not prod never lets a prod use of the same secret through: it still asks, held", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    await t.actions.save({
      projectId: "p1",
      definition: echoDef({ name: "echo-prod", tags: ["prod"] }),
    });
    t.setRules([{ id: "r", match: { requester: "claude" }, decision: "ask", once: "session" }]);
    const first = t.run();
    const a = await t.frame(0);
    expect(a).toMatchObject({ decision: "ask", once: true, needsHold: false });
    t.approveAndDeliver(a, { via: "app", scope: "session" });
    await first;
    const second = t.run({ name: "echo-prod" });
    const b = await t.frame(1);
    expect(b).toMatchObject({ decision: "ask", once: false, needsHold: true });
    t.approveAndDeliver(b, { via: "app", heldMs: 2000 });
    await second;
  });

  test("a prod request that a rule lets be approved for the session is still approved one use at a time: the session scope is refused, even held", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["prod"] }) });
    t.setRules([
      { id: "prod-sessao", match: { requester: "claude" }, decision: "ask", once: "session" },
    ]);
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "ask", needsHold: true });
    const approve = (input: Parameters<Actions["approve"]>[1]) =>
      failure(Promise.resolve().then(() => t.actions.approve(f.requestId, input)));
    expect(await approve({ via: "app", heldMs: 2000, scope: "session" })).toContain("sessão");
    expect(await approve({ via: "app", heldMs: 2000 })).toBe("ok");
    t.deliver(f);
    await running;
  });

  test("prod pede a cada uso, segurando o botão 2 s, e a bandeja não aprova", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["prod"] }) });
    t.setRules([allow()]);
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "ask", once: false, needsHold: true, ruleId: "liberar" });
    const approve = (input: Parameters<Actions["approve"]>[1]) =>
      failure(Promise.resolve().then(() => t.actions.approve(f.requestId, input)));
    expect(await approve({ via: "tray", heldMs: 5000 })).toContain("bandeja");
    expect(await approve({ via: "app" })).toContain("2 s");
    expect(await approve({ via: "app", heldMs: 1999 })).toContain("2 s");
    // Nothing was approved by the refusals.
    expect(await failure(Promise.resolve().then(() => t.actions.gate(f.purpose)))).toContain(
      "aprovação",
    );
    expect(await approve({ via: "app", heldMs: 2000 })).toBe("ok");
    t.actions.gate(f.purpose);
    t.deliver(f);
    await running;
  });

  test("fora de prod a bandeja aprova, sem segurar", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const running = t.run();
    const f = await t.frame();
    expect(f.needsHold).toBe(false);
    t.approveAndDeliver(f, { via: "tray" });
    await running;
  });

  test("prod com uma regra allow de janela passa dentro dela e é negado fora, sem frame", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["prod"] }) });
    t.setRules([
      allow({
        window: { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
      }),
    ]);
    const inside = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "allow", needsHold: false });
    t.deliver(f);
    await inside;

    t.now.at = NOW + 8 * HOUR;
    const outside = await failure(t.run());
    expect(outside).toContain("invalid_state");
    expect(outside).toContain("janela");
    expect(t.requests()).toHaveLength(1);
  });

  test("o risco alto do classificador sobe uma regra allow para ask, e o classificador vê o comando da ação", async () => {
    const seen: string[] = [];
    const t = setup({
      risk: (command) => {
        seen.push(command);
        return "high";
      },
    });
    await t.actions.save({
      projectId: "p1",
      definition: echoDef({ run: [process.execPath, "-e", "console.log(process.env.TOKEN)"] }),
    });
    t.setRules([allow()]);
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "ask", needsHold: true, once: false });
    expect(seen[0]).toContain("console.log(process.env.TOKEN)");
    t.approveAndDeliver(f, { via: "app", heldMs: 2000 });
    await running;
  });
});

describe("regras-aprovacao: run_with_secret", () => {
  const COMMAND = `bun -e "console.log(process.env.TOKEN)"`;

  test("pergunta a cada uso mesmo com uma regra allow, e a aprovação não vale para a sessão", async () => {
    const seen: string[] = [];
    const t = setup({
      risk: (command) => {
        seen.push(command);
        return "low";
      },
    });
    t.setRules([allow({ id: "tudo", match: {} })]);
    const running = t.actions.runFree({
      command: COMMAND,
      secrets: ["token"],
      requestedBy: "claude",
      session: "s1",
    });
    const f = await t.frame();
    expect(f).toMatchObject({
      decision: "ask",
      once: false,
      approval: "always",
      command: COMMAND,
      ruleId: "tudo",
    });
    expect(f.reason).toContain("run_with_secret");
    expect(seen).toEqual([COMMAND]);
    const error = await failure(
      Promise.resolve().then(() =>
        t.actions.approve(f.requestId, { via: "app", scope: "session" }),
      ),
    );
    expect(error).toContain("sessão");
    expect(await failure(Promise.resolve().then(() => t.actions.gate(f.purpose)))).toContain(
      "aprovação",
    );
    t.approveAndDeliver(f);
    expect((await running).output).toBe("•••(token)\n");
  });

  test("o padrão do comando livre é ask, e a automação não o roda", async () => {
    const t = setup();
    const running = t.actions.runFree({
      command: COMMAND,
      secrets: ["token"],
      requestedBy: "claude",
    });
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "ask", ruleId: null });
    t.approveAndDeliver(f);
    await running;
    const denied = await failure(
      t.actions.runFree({ command: COMMAND, secrets: ["token"], requestedBy: "automation" }),
    );
    expect(denied).toContain("automation");
    expect(t.requests()).toHaveLength(1);
  });
});

describe("regras-aprovacao: vence em 10 minutos", () => {
  test("sem resposta o pedido é negado, com o motivo, e some", async () => {
    const t = setup({ requestTimeoutMs: 60 });
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const error = await failure(t.run());
    expect(error).toContain("invalid_state");
    expect(error).toContain("venceu");
    const f = t.requests()[0] as VaultRequestFrame;
    expect(
      await failure(Promise.resolve().then(() => t.actions.approve(f.requestId, { via: "app" }))),
    ).toContain("not_found");
  });
});

describe("regras-aprovacao: a prévia", () => {
  test("preview dá o veredito de um uso hipotético sem registrar nem gastar nada", async () => {
    const t = setup();
    t.setRules([
      allow({
        id: "util",
        match: { requester: "claude", tags: ["staging"] },
        window: { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
        maxPerHour: 1,
      }),
    ]);
    const use = {
      secretId: "token",
      requester: "claude" as const,
      purpose: "action" as const,
      action: "deploy",
      tags: ["staging"],
    };
    expect(t.actions.preview(use)).toMatchObject({ decision: "allow", ruleId: "util" });
    expect(t.actions.preview({ ...use, at: NOW + 8 * HOUR })).toMatchObject({ decision: "deny" });
    expect(t.actions.preview({ ...use, requester: "automation" })).toMatchObject({
      decision: "deny",
      ruleId: null,
    });
    expect(t.actions.preview({ ...use, risk: "high" })).toMatchObject({
      decision: "ask",
      needsHold: true,
    });
    expect(t.actions.preview({ ...use, actionApproval: "always", tags: [] })).toMatchObject({
      decision: "ask",
      once: false,
    });
    expect(t.actions.decisions({})).toEqual([]);
    expect(t.requests()).toEqual([]);
  });
});

describe("regras-aprovacao: as regras de um segredo", () => {
  const ruleList: Rule[] = [{ id: "r1", match: { requester: "claude" }, decision: "ask" }];

  test("guarda as regras e as tags do segredo, troca tudo ao guardar de novo e devolve vazio para quem não tem", () => {
    const rules = new VaultRules();
    expect(rules.set("tok", ["Prod"], ruleList)).toBe(1);
    expect(rules.get("tok")).toEqual({ tags: ["prod"], rules: ruleList });
    expect(rules.rulesFor("tok")).toEqual(ruleList);
    expect(rules.tagsFor("tok")).toEqual(["prod"]);
    expect(rules.set("tok", [], [])).toBe(0);
    expect(rules.get("tok")).toEqual({ tags: [], rules: [] });
    expect(rules.get("outro")).toEqual({ tags: [], rules: [] });
    expect(rules.rulesFor("outro")).toEqual([]);
    expect(rules.tagsFor("outro")).toEqual([]);
  });

  test("regras fora do teto ou malformadas são recusadas inteiras, com o motivo, e as antigas ficam", () => {
    const rules = new VaultRules();
    rules.set("tok", [], ruleList);
    let error: FlightdeckError | undefined;
    try {
      rules.set("tok", [], [{ id: "x", decision: "allow", match: { purpose: "run_with_secret" } }]);
    } catch (e) {
      error = e as FlightdeckError;
    }
    expect(error?.code).toBe("bad_request");
    expect(error?.message).toContain("run_with_secret");
    expect(rules.rulesFor("tok")).toEqual(ruleList);
  });
});

describe("regras-aprovacao: as tags do uso", () => {
  test("as tags da ação e as do segredo juntam sem repetir, no frame e na decisão", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["prod", "api"] }) });
    t.setRules([], ["prod", "pci"]);
    const running = t.run();
    const f = await t.frame();
    expect(f.tags).toEqual(["prod", "api", "pci"]);
    expect(f.needsHold).toBe(true);
    t.approveAndDeliver(f, { via: "app", heldMs: 2000 });
    await running;
    expect(
      t.actions.preview({
        secretId: "token",
        requester: "claude",
        purpose: "action",
        tags: ["api"],
      }),
    ).toMatchObject({ decision: "ask", needsHold: true });
  });
});
