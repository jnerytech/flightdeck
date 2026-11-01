import { afterEach, describe, expect, test } from "bun:test";
import { Actions } from "../src/actions/actions.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { VaultRules } from "../src/vault/rules-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { gitRepo } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "regras-token-0123456789abcdef";
const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const echoDef = {
  name: "echo",
  description: "imprime o token",
  run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
  env: { TOKEN: "{{secret.token}}" },
};

function setup(options: { actions?: boolean } = {}) {
  const { manager } = newManager();
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const actions = new Actions({
    db: store.db,
    vault,
    rules: new VaultRules(),
    hostName: "vps",
    hostBase: tempDir("fd-host-"),
    requestTimeoutMs: 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
  });
  const server = startServer({
    manager,
    vault,
    ...(options.actions === false ? {} : { actions }),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => {
    server.stop();
    actions.stop();
    vault.stop();
  });
  return { server };
}

async function connect(url: string) {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

type Request = {
  requestId: string;
  secretId: string;
  purpose: string;
  decision?: string;
  needsHold?: boolean;
};
const requestsOf = (client: FrameClient) =>
  client.frames.filter((f) => f.type === "vault.request") as unknown as Request[];

const deliver = (client: FrameClient, request: Request) =>
  client.request("vault.deliver", {
    secretId: request.secretId,
    value: VALUE,
    purpose: request.purpose,
    expiresAt: Date.now() + 30_000,
    requester: "claude",
  });

describe("regras-protocolo", () => {
  test("sem o serviço de ações os comandos das regras respondem invalid_state", async () => {
    const { server } = setup({ actions: false });
    const client = await connect(server.url);
    for (const [type, payload] of [
      ["vault.rules.set", { secretId: "t", rules: [] }],
      ["vault.rules.get", { secretId: "t" }],
      ["vault.rules.preview", { secretId: "t", requester: "claude", purpose: "action" }],
      ["vault.approve", { requestId: "r", via: "app" }],
      ["vault.decisions", {}],
      ["vault.report", {}],
    ] as const) {
      expect(await client.request(type, payload)).toMatchObject({
        ok: false,
        error: { code: "invalid_state" },
      });
    }
  });

  test("guardar as regras, ler de volta, e o app recusa as que passam do teto, explicando", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    expect(
      await app.data("vault.rules.set", {
        secretId: "token",
        tags: ["staging"],
        rules: [{ id: "r1", match: { requester: "claude" }, decision: "ask", once: "session" }],
      }),
    ).toEqual({ rules: 1 });
    expect(await app.data("vault.rules.get", { secretId: "token" })).toMatchObject({
      secretId: "token",
      tags: ["staging"],
      rules: [{ id: "r1" }],
    });
    const refused = await app.request("vault.rules.set", {
      secretId: "token",
      rules: [{ id: "x", decision: "allow", match: { purpose: "run_with_secret" } }],
    });
    expect(refused).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(JSON.stringify(refused)).toContain("run_with_secret");
    expect(refused.error).toMatchObject({
      reason: "vault_rules_invalid",
      params: { count: 1 },
      items: [{ path: "0.decision", code: "no_allow_run_with_secret" }],
    });
    expect((refused.error as { message: string }).message).not.toMatch(/[À-ú]|\bregra\b/);
    // The previous rules stay.
    expect(
      (await app.data<{ rules: unknown[] }>("vault.rules.get", { secretId: "token" }))?.rules,
    ).toHaveLength(1);
  });

  test("a prévia diz o que aconteceria, sem registrar nada", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    await app.data("vault.rules.set", {
      secretId: "token",
      rules: [
        { id: "liberar", match: { requester: "claude", action: "deploy-*" }, decision: "allow" },
      ],
    });
    const preview = (over: Record<string, unknown>) =>
      app.data("vault.rules.preview", {
        secretId: "token",
        requester: "claude",
        purpose: "action",
        action: "deploy-staging",
        ...over,
      });
    expect(await preview({})).toMatchObject({ decision: "allow", ruleId: "liberar" });
    expect(await preview({ requester: "automation" })).toMatchObject({ decision: "deny" });
    expect(await preview({ purpose: "run_with_secret" })).toMatchObject({
      decision: "ask",
      once: false,
    });
    expect(await preview({ tags: ["prod"] })).toMatchObject({ decision: "ask", needsHold: true });
    expect((await app.data<{ decisions: unknown[] }>("vault.decisions", {}))?.decisions).toEqual(
      [],
    );
  });

  test("a entrega de um pedido que pergunta só passa depois do vault.approve; a bandeja não aprova prod", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await app.data("actions.save", { projectId: "p1", definition: echoDef });
    await app.request("vault.watch", {});
    const running = claude.request("actions.run", {
      projectId: "p1",
      name: "echo",
      requestedBy: "claude",
      session: "s1",
    });
    const request = (await poll(() => requestsOf(app)[0])) as Request;
    expect(request).toMatchObject({ decision: "ask", needsHold: false });

    expect(await deliver(app, request)).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(await app.request("vault.approve", { requestId: "nada", via: "app" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(
      await app.request("vault.approve", { requestId: request.requestId, via: "tray" }),
    ).toMatchObject({ ok: true });
    expect(await deliver(app, request)).toMatchObject({ ok: true });

    const ack = (await running) as { ok: boolean; data: { output: string } };
    expect(ack.data.output).toBe("•••(token)\n");

    const decisions = await app.data<{ decisions: Array<{ outcome: string; approver: string }> }>(
      "vault.decisions",
      { secretId: "token" },
    );
    expect(decisions?.decisions[0]).toMatchObject({ outcome: "approved", approver: "tray" });
    const alert = await poll(() => app.frames.find((f) => f.type === "vault.alert"), 2000);
    expect(alert).toMatchObject({ kind: "new-requester", secretId: "token", requester: "claude" });
    expect(JSON.stringify([app.frames, claude.frames])).not.toContain(VALUE);
  });

  test("prod exige segurar 2 s pelo protocolo, e o relatório sai em JSON e em CSV", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await app.data("actions.save", {
      projectId: "p1",
      definition: { ...echoDef, tags: ["prod"] },
    });
    await app.request("vault.watch", {});
    const running = claude.request("actions.run", {
      projectId: "p1",
      name: "echo",
      requestedBy: "claude",
    });
    const request = (await poll(() => requestsOf(app)[0])) as Request;
    expect(request.needsHold).toBe(true);
    expect(
      await app.request("vault.approve", {
        requestId: request.requestId,
        via: "app",
        heldMs: 1500,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(
      await app.request("vault.approve", {
        requestId: request.requestId,
        via: "app",
        heldMs: 2000,
      }),
    ).toMatchObject({ ok: true });
    await deliver(app, request);
    await running;

    const json = await app.data<{ rows: unknown[]; csv?: string }>("vault.report", { days: 30 });
    expect(json?.rows).toEqual([
      { secretId: "token", requester: "claude", outcome: "approved", count: 1 },
    ]);
    expect(json?.csv).toBeUndefined();
    const csv = await app.data<{ csv?: string }>("vault.report", { format: "csv" });
    expect(csv?.csv).toBe("secret,requester,outcome,count\r\ntoken,claude,approved,1");
  });
});
