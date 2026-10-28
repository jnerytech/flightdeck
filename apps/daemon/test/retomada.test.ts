import { afterEach, describe, expect, test } from "bun:test";
import { Command } from "@flightdeck/protocol";
import { HistoryIndexer, MAYBE_ACTIVE_MS } from "../src/history/indexer.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import {
  FrameClient,
  projectsRoot,
  summaryLine,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const TOKEN = "retomada-token-0123456789";
const ID = "55555555-5555-4555-8555-555555555555";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * A daemon whose history holds one transcript in `cwd` (inside the allowed root unless given),
 * with the clock `offsetMs` after the file was written.
 */
async function setup(offsetMs: number, cwd?: string) {
  const ctx = newManager();
  const root = projectsRoot();
  writeTranscript(root, "-p", ID, [
    userLine({ uuid: "u1", text: "conversa de fora", cwd: cwd ?? ctx.project }),
    summaryLine("Conversa de fora", "u1"),
  ]);
  const history = new HistoryIndexer({
    db: ctx.store.db,
    roots: [root],
    now: () => Date.now() + offsetMs,
  });
  history.scan();
  const server = startServer({
    manager: ctx.manager,
    history,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { ...ctx, history, client };
}

describe("retomada", () => {
  test("schema de history.resume", () => {
    const ok = (payload: unknown) =>
      Command.safeParse({ id: "1", type: "history.resume", payload }).success;
    expect(ok({ claudeSessionId: ID })).toBe(true);
    expect(ok({ claudeSessionId: ID, name: "n", permissionMode: "plan", force: true })).toBe(true);
    expect(ok({ claudeSessionId: ID, force: "sim" })).toBe(false);
  });

  test("maybeActive: arquivo alterado nos últimos 2 minutos", async () => {
    expect(MAYBE_ACTIVE_MS).toBe(120_000);
    const recent = await setup(0);
    expect(recent.history.session(ID)?.maybeActive).toBe(true);
    const old = await setup(MAYBE_ACTIVE_MS + 1000);
    expect(old.history.session(ID)?.maybeActive).toBe(false);
  });

  test("sessão maybeActive recusa sem force e não cria nada", async () => {
    const { client, manager, runtime } = await setup(0);
    const ack = await client.request("history.resume", { claudeSessionId: ID });
    expect(ack).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    expect(String((ack.error as { message?: string } | undefined)?.message)).toContain("force");
    expect(manager.list()).toEqual([]);
    expect(runtime.starts).toEqual([]);
  });

  test("com force cria a sessão gerenciada com resume apontando para o claudeSessionId", async () => {
    const { client, manager, runtime, project } = await setup(0);
    const result = await client.data<{ sessionId: string }>("history.resume", {
      claudeSessionId: ID,
      force: true,
      permissionMode: "acceptEdits",
    });
    expect(result?.sessionId).toBeString();
    const sessionId = result?.sessionId ?? "";
    expect(runtime.starts.map((s) => [s.resume, s.cwd, s.permissionMode])).toEqual([
      [ID, project, "acceptEdits"],
    ]);
    const session = manager.get(sessionId);
    expect([session.status, session.claudeSessionId, session.name, session.cwd]).toEqual([
      "idle",
      ID,
      "Conversa de fora",
      project,
    ]);
    // The next message continues the same Claude session.
    manager.send(sessionId, "continuando");
    const init = await poll(
      () => manager.get(sessionId).status === "idle" && runtime.starts.length,
    );
    expect(init).toBe(1);
    expect(manager.get(sessionId).claudeSessionId).toBe(ID);
  });

  test("sessão parada há mais de 2 minutos retoma sem force e aceita um nome", async () => {
    const { client, manager, runtime } = await setup(MAYBE_ACTIVE_MS + 1000);
    const result = await client.data<{ sessionId: string }>("history.resume", {
      claudeSessionId: ID,
      name: "retomada",
    });
    expect(manager.list().map((s) => [s.id, s.name])).toEqual([
      [result?.sessionId ?? "", "retomada"],
    ]);
    expect(runtime.starts[0]?.resume).toBe(ID);
    expect(runtime.starts[0]?.permissionMode).toBe("default");
  });

  test("transcript desconhecido é not_found; pasta fora de allowedRoots é forbidden_cwd", async () => {
    const { client } = await setup(MAYBE_ACTIVE_MS + 1000, "/fora/dos/roots");
    expect(await client.request("history.resume", { claudeSessionId: "nada" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(await client.request("history.resume", { claudeSessionId: ID })).toMatchObject({
      ok: false,
      error: { code: "forbidden_cwd" },
    });
  });
});
