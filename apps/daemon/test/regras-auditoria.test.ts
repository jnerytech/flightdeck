import { afterEach, describe, expect, test } from "bun:test";
import type { VaultAlertFrame, VaultRequestFrame } from "@flightdeck/protocol";
import { Actions, type ActionsFrame, type ActionsOptions } from "../src/actions/actions.ts";
import type { FlightdeckError } from "../src/errors.ts";
import { EventStore } from "../src/store/event-store.ts";
import { csvCell, toCsv } from "../src/vault/report.ts";
import { VaultRules } from "../src/vault/rules-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { gitRepo } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";

const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";
/** Wednesday 2026-10-28, 12:00 in São Paulo. */
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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

function setup(over: Partial<ActionsOptions> = {}) {
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
  const unwatch = actions.watch((frame) => frames.push(frame));
  cleanups.push(() => {
    unwatch();
    actions.stop();
    vault.stop();
  });
  const requests = () => frames.filter((f): f is VaultRequestFrame => f.type === "vault.request");
  const alerts = () => frames.filter((f): f is VaultAlertFrame => f.type === "vault.alert");
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
  const frame = async (n = 0) => (await poll(() => requests()[n])) as VaultRequestFrame;
  return { actions, vault, rules, store, now, frames, requests, alerts, deliver, run, frame };
}

const allow = (over: Record<string, unknown> = {}) => ({
  id: "liberar",
  match: { requester: "claude" },
  decision: "allow",
  ...over,
});

describe("regras-auditoria: o registro de cada decisão", () => {
  test("allow por regra: a regra, a decisão, quem liberou e o resultado", async () => {
    const t = setup({ projectKey: () => "github.com/acme/app" });
    await t.actions.save({ projectId: "p1", definition: echoDef({ tags: ["staging"] }) });
    t.rules.set("token", [], [allow()]);
    const running = t.run();
    t.deliver(await t.frame());
    await running;
    const [row] = t.actions.decisions({});
    expect(row).toMatchObject({
      secretId: "token",
      requester: "claude",
      purpose: "action",
      action: "echo",
      host: "vps",
      project: "github.com/acme/app",
      session: "s1",
      ruleId: "liberar",
      decision: "allow",
      outcome: "allowed",
      approver: "rule",
      window: null,
    });
    expect(row?.id.length).toBeGreaterThan(10);
    expect(row?.at).toBe(new Date(NOW).toISOString());
    expect(row?.reason).toContain("liberar");
  });

  test("ask aprovado pelo app, pela bandeja e na sessão: o aprovador fica registrado", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const first = t.run();
    const a = await t.frame(0);
    t.actions.approve(a.requestId, { via: "app", scope: "session" });
    t.deliver(a);
    await first;
    const second = t.run();
    t.deliver(await t.frame(1));
    await second;
    const third = t.run({ session: "s2" });
    const c = await t.frame(2);
    t.actions.approve(c.requestId, { via: "tray" });
    t.deliver(c);
    await third;
    expect(
      t.actions
        .decisions({})
        .map((d) => [d.outcome, d.approver, d.decision])
        .reverse(),
    ).toEqual([
      ["approved", "app", "ask"],
      ["allowed", "session", "allow"],
      ["approved", "tray", "ask"],
    ]);
  });

  test("recusado pelo usuário, vencido, cancelado e negado por regra, cada um com o seu resultado", async () => {
    const t = setup({ requestTimeoutMs: 300 });
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const denied = failure(t.run());
    const f = await t.frame(0);
    t.actions.deny(f.requestId);
    await denied;
    await failure(t.run({ session: "s2" }));
    const cancelled = failure(t.run({ session: "s3" }));
    await t.frame(2);
    t.actions.stop();
    await cancelled;
    const refused = setup();
    await refused.actions.save({ projectId: "p1", definition: echoDef() });
    refused.rules.set("token", [], [{ id: "nada", decision: "deny" }]);
    await failure(refused.run());
    expect(
      t.actions
        .decisions({})
        .map((d) => d.outcome)
        .reverse(),
    ).toEqual(["denied", "expired", "failed"]);
    expect(refused.actions.decisions({})[0]).toMatchObject({
      outcome: "refused",
      decision: "deny",
      ruleId: "nada",
      approver: null,
    });
  });

  test("enquanto espera o pedido está pending, e a janela da regra fica registrada como estava", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    const window = { days: ["wed"], from: "08:00", to: "18:00" };
    t.rules.set("token", [], [allow({ window })]);
    const running = t.run();
    const f = await t.frame();
    const [waiting] = t.actions.decisions({});
    expect(waiting).toMatchObject({ outcome: "pending", decision: "allow", approver: null });
    expect(JSON.parse(waiting?.window ?? "null")).toEqual(window);
    t.deliver(f);
    await running;
  });

  test("o comando livre também é registrado, com a finalidade run_with_secret", async () => {
    const t = setup();
    const running = t.actions.runFree({
      command: `bun -e "console.log(process.env.TOKEN)"`,
      secrets: ["token"],
      requestedBy: "claude",
      session: "s1",
    });
    const f = await t.frame();
    t.actions.approve(f.requestId, { via: "app" });
    t.deliver(f);
    await running;
    expect(t.actions.decisions({})[0]).toMatchObject({
      purpose: "run_with_secret",
      action: null,
      outcome: "approved",
      approver: "app",
    });
  });

  test("filtra por segredo, por dias e por limite, do mais novo ao mais antigo", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.rules.set("token", [], [allow()]);
    for (const daysAgo of [40, 10, 0]) {
      t.now.at = NOW - daysAgo * DAY;
      const running = t.run();
      t.deliver(await t.frame(t.requests().length));
      await running;
    }
    t.now.at = NOW;
    expect(t.actions.decisions({}).map((d) => d.at.slice(0, 10))).toEqual([
      "2026-10-28",
      "2026-10-18",
    ]);
    expect(t.actions.decisions({ days: 365 })).toHaveLength(3);
    expect(t.actions.decisions({ days: 365, limit: 2 })).toHaveLength(2);
    expect(t.actions.decisions({ secretId: "outro" })).toEqual([]);
    expect(t.actions.decisions({ secretId: "token", days: 5 })).toHaveLength(1);
  });
});

describe("regras-auditoria: os limites contam o que passou", () => {
  test("maxPerHour: estourou, o uso seguinte é negado com aviso até o período virar", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.rules.set("token", [], [allow({ maxPerHour: 2 })]);
    for (let i = 0; i < 2; i++) {
      const running = t.run();
      t.deliver(await t.frame(i));
      await running;
    }
    const error = await failure(t.run());
    expect(error).toContain("invalid_state");
    expect(error).toContain("por hora");
    expect(t.alerts().find((a) => a.kind === "limit")).toMatchObject({
      secretId: "token",
      requester: "claude",
    });
    expect(t.alerts().find((a) => a.kind === "limit")?.message).toContain("liberar");
    expect(t.actions.decisions({})[0]).toMatchObject({ outcome: "refused", decision: "deny" });

    t.now.at = NOW + HOUR + 1;
    const again = t.run();
    t.deliver(await t.frame(2));
    await again;
  });

  test("o que o usuário negou ou venceu não gasta o limite", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.rules.set("token", [], [{ id: "p", decision: "ask", maxPerHour: 1 }]);
    const denied = failure(t.run());
    t.actions.deny((await t.frame(0)).requestId);
    await denied;
    const running = t.run();
    const f = await t.frame(1);
    t.actions.approve(f.requestId, { via: "app" });
    t.deliver(f);
    await running;
    expect(await failure(t.run())).toContain("por hora");
  });
});

describe("regras-auditoria: o alerta de solicitante novo", () => {
  test("a primeira vez de um solicitante num segredo avisa, mesmo quando a regra permite; a segunda não", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.rules.set("token", [], [allow({ id: "auto", match: { requester: "automation" } }), allow()]);
    const first = t.run({ requestedBy: "automation" });
    t.deliver(await t.frame(0));
    await first;
    expect(t.alerts()).toHaveLength(1);
    expect(t.alerts()[0]).toMatchObject({
      kind: "new-requester",
      secretId: "token",
      requester: "automation",
    });
    expect(t.alerts()[0]?.message).toContain("automation");
    const second = t.run({ requestedBy: "automation" });
    t.deliver(await t.frame(1));
    await second;
    expect(t.alerts()).toHaveLength(1);
    // Another requester of the same secret is new again.
    const claude = t.run();
    t.deliver(await t.frame(2));
    await claude;
    expect(t.alerts().map((a) => a.requester)).toEqual(["automation", "claude"]);
  });

  test("um pedido recusado também conta como a primeira vez", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    await failure(t.run({ requestedBy: "workflow" }));
    expect(t.alerts().map((a) => a.requester)).toEqual(["workflow"]);
    await failure(t.run({ requestedBy: "workflow" }));
    expect(t.alerts()).toHaveLength(1);
  });
});

describe("regras-auditoria: o relatório do cofre", () => {
  test("usos por segredo, solicitante e resultado nos últimos 30 dias", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    t.rules.set("token", [], [allow()]);
    for (const daysAgo of [45, 3, 2, 0]) {
      t.now.at = NOW - daysAgo * DAY;
      const running = t.run();
      t.deliver(await t.frame(t.requests().length));
      await running;
    }
    t.now.at = NOW;
    await failure(t.run({ requestedBy: "automation" }));
    const { rows, csv } = t.actions.report({});
    expect(rows).toEqual([
      { secretId: "token", requester: "automation", outcome: "refused", count: 1 },
      { secretId: "token", requester: "claude", outcome: "allowed", count: 3 },
    ]);
    expect(csv).toBeUndefined();
    expect(t.actions.report({ days: 60 }).rows.find((r) => r.requester === "claude")?.count).toBe(
      4,
    );
    expect(t.actions.report({ days: 1 }).rows.find((r) => r.requester === "claude")?.count).toBe(1);
  });

  test("com format csv o texto vem junto, com cabeçalho", async () => {
    const t = setup();
    await t.actions.save({ projectId: "p1", definition: echoDef() });
    await failure(t.run({ requestedBy: "automation" }));
    const { rows, csv } = t.actions.report({ format: "csv" });
    expect(csv).toBe(toCsv(rows));
    expect(csv).toContain("token,automation,refused,1");
  });

  test("o CSV escapa vírgula, aspas e quebra de linha, e não deixa uma fórmula valer", () => {
    expect(csvCell("simples")).toBe("simples");
    expect(csvCell(42)).toBe("42");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell("duas\nlinhas")).toBe('"duas\nlinhas"');
    for (const formula of ["=1+1", "+1", "-1", "@SOMA(A1)", "\tx", "\rx"]) {
      expect(csvCell(formula).replaceAll('"', "").startsWith("'")).toBe(true);
    }
    expect(toCsv([{ secretId: "-tok", requester: "claude", outcome: "allowed", count: 2 }])).toBe(
      "secret,requester,outcome,count\r\n'-tok,claude,allowed,2",
    );
    expect(toCsv([])).toBe("secret,requester,outcome,count");
  });
});
