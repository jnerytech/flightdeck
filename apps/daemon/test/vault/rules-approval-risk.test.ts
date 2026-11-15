import { afterEach, describe, expect, test } from "bun:test";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import type { Actions } from "../../src/actions/actions.ts";
import {
  allow,
  echoDef,
  failure,
  HOUR,
  NOW,
  runCleanups,
  setup,
} from "../support/rules-approval.ts";

afterEach(runCleanups);

describe("regras-aprovacao: prod e risco alto", () => {
  test("a use tagged producao (no accent) is prod too: it asks at every use, held", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["producao"] }) });
    t.setRules([allow()]);
    const running = t.run();
    const f = await t.frame();
    expect(f).toMatchObject({ decision: "ask", needsHold: true });
    t.approveAndDeliver(f, { via: "app", heldMs: 2000 });
    await running;
  });

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
    expect(await approve({ via: "app", heldMs: 2000, scope: "session" })).toContain(
      "[action_session_refused_risky]",
    );
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
    expect(await approve({ via: "tray", heldMs: 5000 })).toContain("[action_tray_refused]");
    expect(await approve({ via: "app" })).toContain("[action_hold_needed]");
    expect(await approve({ via: "app", heldMs: 1999 })).toContain("[action_hold_needed]");
    // Nothing was approved by the refusals.
    expect(await failure(Promise.resolve().then(() => t.actions.gate(f.purpose)))).toContain(
      "[action_needs_approval]",
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
    expect(outside).toContain("window");
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
    expect(error).toContain("[action_session_refused_rule]");
    expect(await failure(Promise.resolve().then(() => t.actions.gate(f.purpose)))).toContain(
      "[action_needs_approval]",
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
    expect(error).toContain("[action_secret_expired]");
    const f = t.requests()[0] as VaultRequestFrame;
    expect(
      await failure(Promise.resolve().then(() => t.actions.approve(f.requestId, { via: "app" }))),
    ).toContain("not_found");
  });
});
