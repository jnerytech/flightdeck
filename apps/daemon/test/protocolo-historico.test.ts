import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, ServerMessage } from "@flightdeck/protocol";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { startDaemon } from "../src/main.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import {
  appendRaw,
  assistantLine,
  FrameClient,
  projectsRoot,
  summaryLine,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const TOKEN = "historico-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const NEW = "/home/dev/novo";

/** Three sessions; the newest has five readable entries plus a tool result and a raw line. */
function fixtures() {
  const root = projectsRoot();
  writeTranscript(root, "-old", "s-old", [
    userLine({ uuid: "o1", text: "velha", cwd: "/home/dev/velho", ts: "2026-09-01T10:00:00.000Z" }),
  ]);
  writeTranscript(root, "-mid", "s-mid", [
    userLine({
      uuid: "m1",
      text: "do meio",
      cwd: "/home/dev/meio",
      ts: "2026-09-05T10:00:00.000Z",
    }),
  ]);
  const newest = writeTranscript(root, "-new", "s-new", [
    userLine({ uuid: "u1", text: "primeira", cwd: NEW, ts: "2026-09-10T10:00:00.000Z" }),
    assistantLine({ uuid: "a1", text: "resposta um", cwd: NEW, ts: "2026-09-10T10:00:01.000Z" }),
    JSON.stringify({
      type: "user",
      cwd: NEW,
      uuid: "t1",
      timestamp: "2026-09-10T10:00:02.000Z",
      message: { role: "user", content: [{ type: "tool_result", content: "saída" }] },
    }),
    userLine({ uuid: "u2", text: "segunda pergunta", cwd: NEW, ts: "2026-09-10T10:00:03.000Z" }),
    JSON.stringify({ type: "file-history-snapshot", messageId: "u2" }),
    assistantLine({ uuid: "a2", text: "resposta dois", cwd: NEW, ts: "2026-09-10T10:00:04.000Z" }),
    summaryLine("Conversa nova", "a2"),
  ]);
  return { root, newest };
}

function serve(history?: HistoryIndexer): RunningServer {
  const { manager } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...(history ? { history } : {}),
  });
  cleanups.push(() => server.stop());
  return server;
}

async function connect(url: string): Promise<FrameClient> {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

function indexer(
  root: string,
  extra: Partial<ConstructorParameters<typeof HistoryIndexer>[0]> = {},
) {
  const store = new EventStore(":memory:");
  const index = new HistoryIndexer({ db: store.db, roots: [root], ...extra });
  cleanups.push(() => index.stop());
  return index;
}

interface Listed {
  sessions: Array<Record<string, unknown>>;
  nextCursor: string | null;
}
interface Got {
  session: Record<string, unknown> | null;
  messages: Array<{ uuid: string }>;
  nextCursor: string | null;
  prevCursor: string | null;
}

const changed = (client: FrameClient, id: string) =>
  client.frames.find((f) => f.type === "history.changed" && f.claudeSessionId === id);

describe("protocolo-historico", () => {
  test("schema: comandos history.* e o frame history.changed", () => {
    const ok = (type: string, payload: unknown) =>
      Command.safeParse({ id: "1", type, payload }).success;
    expect(ok("history.list", { limit: 10, cursor: "2", origin: "external" })).toBe(true);
    expect(ok("history.list", { origin: "outra" })).toBe(false);
    expect(ok("history.get", { claudeSessionId: "x", cursor: "0", limit: 5 })).toBe(true);
    expect(ok("history.get", {})).toBe(false);
    expect(ok("history.search", { query: "termo", cwd: "/p", from: "a", to: "b", limit: 5 })).toBe(
      true,
    );
    expect(ok("history.search", { query: "" })).toBe(false);
    expect(ok("history.watch", {})).toBe(true);
    const frame = {
      type: "history.changed",
      claudeSessionId: "x",
      cwd: "/p",
      lastTs: null,
      maybeActive: true,
    };
    expect(ServerMessage.safeParse(frame).success).toBe(true);
    expect(ServerMessage.safeParse({ ...frame, maybeActive: "sim" }).success).toBe(false);
  });

  test("history.list pagina com cursor, mais recente primeiro, com filtros", async () => {
    const { root } = fixtures();
    const index = indexer(root);
    index.scan();
    const client = await connect(serve(index).url);

    const first = await client.data<Listed>("history.list", { limit: 2 });
    expect(first?.sessions.map((s) => s.claudeSessionId)).toEqual(["s-new", "s-mid"]);
    expect(first?.sessions[0]).toEqual({
      claudeSessionId: "s-new",
      cwd: NEW,
      title: "Conversa nova",
      firstTs: "2026-09-10T10:00:00.000Z",
      lastTs: "2026-09-10T10:00:04.000Z",
      messageCount: 4,
      origin: "external",
      // Written a moment ago.
      maybeActive: true,
    });
    expect(first?.nextCursor).not.toBeNull();
    const second = await client.data<Listed>("history.list", {
      limit: 2,
      cursor: first?.nextCursor,
    });
    expect(second?.sessions.map((s) => s.claudeSessionId)).toEqual(["s-old"]);
    expect(second?.nextCursor).toBeNull();

    const ids = async (payload: object) =>
      (await client.data<Listed>("history.list", payload))?.sessions.map((s) => s.claudeSessionId);
    expect(await ids({ cwd: "/home/dev/meio" })).toEqual(["s-mid"]);
    expect(await ids({ origin: "flightdeck" })).toEqual([]);
    expect(await ids({ from: "2026-09-04T00:00:00.000Z" })).toEqual(["s-new", "s-mid"]);
    expect(await ids({ to: "2026-09-04T00:00:00.000Z" })).toEqual(["s-old"]);
  });

  test("history.get pagina as mensagens normalizadas com cursor nos dois sentidos", async () => {
    const { root } = fixtures();
    const index = indexer(root);
    index.scan();
    const client = await connect(serve(index).url);

    const page1 = await client.data<Got>("history.get", { claudeSessionId: "s-new", limit: 2 });
    expect(page1?.session?.title).toBe("Conversa nova");
    expect(page1?.messages).toEqual([
      {
        uuid: "u1",
        ts: "2026-09-10T10:00:00.000Z",
        role: "user",
        kind: "message",
        text: "primeira",
      },
      {
        uuid: "a1",
        ts: "2026-09-10T10:00:01.000Z",
        role: "assistant",
        kind: "message",
        text: "resposta um",
      },
    ]);
    expect([page1?.prevCursor, page1?.nextCursor]).toEqual([null, "2"]);
    // Tool results and raw lines are not part of the readable transcript.
    const page2 = await client.data<Got>("history.get", {
      claudeSessionId: "s-new",
      cursor: "2",
      limit: 2,
    });
    expect(page2?.messages.map((m) => m.uuid)).toEqual(["u2", "a2"]);
    expect([page2?.prevCursor, page2?.nextCursor]).toEqual(["0", "4"]);
    const page3 = await client.data<Got>("history.get", {
      claudeSessionId: "s-new",
      cursor: "4",
      limit: 2,
    });
    expect(page3?.messages.map((m) => m.uuid)).toEqual(["summary:a2"]);
    expect([page3?.prevCursor, page3?.nextCursor]).toEqual(["2", null]);

    const missing = await client.request("history.get", { claudeSessionId: "nada" });
    expect(missing).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("history.search pela rede: acerto traz o cursor que abre o leitor nele", async () => {
    const { root } = fixtures();
    const index = indexer(root);
    index.scan();
    const client = await connect(serve(index).url);
    const result = await client.data<{ hits: Array<Record<string, unknown>> }>("history.search", {
      query: "segunda",
    });
    expect(result?.hits).toEqual([
      {
        claudeSessionId: "s-new",
        uuid: "u2",
        ts: "2026-09-10T10:00:03.000Z",
        cwd: NEW,
        title: "Conversa nova",
        role: "user",
        snippet: "«segunda» pergunta",
        cursor: "2",
      },
    ]);
    const opened = await client.data<Got>("history.get", {
      claudeSessionId: "s-new",
      cursor: String(result?.hits[0]?.cursor),
      limit: 1,
    });
    expect(opened?.messages.map((m) => m.uuid)).toEqual(["u2"]);
  });

  test("history.watch recebe history.changed quando um arquivo cresce (varredura de reserva)", async () => {
    const { root, newest } = fixtures();
    // The watcher is the fast path; a long interval would hide a broken fallback, so use both
    // here and a watcher-only setup below.
    const index = indexer(root, { scanIntervalMs: 30 });
    index.scan();
    index.start();
    const client = await connect(serve(index).url);
    expect(await client.request("history.watch", {})).toMatchObject({ ok: true });
    appendRaw(
      newest,
      `${userLine({ uuid: "u3", text: "mais", cwd: NEW, ts: "2026-09-11T00:00:00.000Z" })}\n`,
    );
    const frame = await poll(() => changed(client, "s-new"));
    expect(frame).toEqual({
      type: "history.changed",
      claudeSessionId: "s-new",
      cwd: NEW,
      lastTs: "2026-09-11T00:00:00.000Z",
      maybeActive: true,
    });
    // Nothing else changed.
    expect(client.frames.filter((f) => f.type === "history.changed")).toHaveLength(1);
  });

  test("a observação do sistema de arquivos dispara a indexação sem esperar a varredura", async () => {
    const { root, newest } = fixtures();
    const index = indexer(root, { scanIntervalMs: 60_000 });
    index.start();
    const received: string[] = [];
    const stop = index.onChange((c) => received.push(c.claudeSessionId));
    // The boot pass runs right after start.
    expect((await poll(() => received.length === 3 && received)) ?? []).toEqual(
      expect.arrayContaining(["s-old", "s-mid", "s-new"]),
    );
    appendRaw(newest, `${userLine({ uuid: "u9", text: "x", cwd: NEW })}\n`);
    expect(await poll(() => received.includes("s-new") && received.length === 4)).toBe(true);
    stop();
    appendRaw(newest, `${userLine({ uuid: "u10", text: "y", cwd: NEW })}\n`);
    await Bun.sleep(200);
    expect(received).toHaveLength(4);
  });

  test("falhas na varredura e na observação são registradas e não derrubam o daemon", async () => {
    const logs: string[] = [];
    const store = new EventStore(":memory:");
    const missing = join(tempDir(), "nao-existe");
    const index = new HistoryIndexer({
      db: store.db,
      roots: [missing],
      log: (m) => logs.push(m),
      scanIntervalMs: 20,
    });
    cleanups.push(() => index.stop());
    store.close();
    index.start();
    expect(await poll(() => logs.some((l) => l.startsWith("histórico: falha na varredura")))).toBe(
      true,
    );
    expect(logs.some((l) => l.startsWith(`histórico: sem observação de ${missing}`))).toBe(true);
  });

  test("sem índice de histórico os comandos respondem invalid_state", async () => {
    const client = await connect(serve().url);
    const ack = await client.request("history.list", {});
    expect(ack).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("startDaemon indexa history.roots no boot e atende history.list", async () => {
    const { root } = fixtures();
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        history: { roots: [root], scanIntervalMs: 50 },
      }),
    );
    const out: string[] = [];
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      {
        log: (m) => out.push(m),
        error: (m) => out.push(m),
      },
    );
    cleanups.push(() => daemon.stop());
    const client = await connect(daemon.url);
    let sessions: unknown[] = [];
    for (let i = 0; i < 100 && sessions.length < 3; i++) {
      sessions = (await client.data<Listed>("history.list", {}))?.sessions ?? [];
      if (sessions.length < 3) await Bun.sleep(20);
    }
    expect(sessions).toHaveLength(3);
    expect(out).toContain("histórico: busca com FTS5");
  });
});
