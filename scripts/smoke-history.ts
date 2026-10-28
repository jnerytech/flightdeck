#!/usr/bin/env bun
/**
 * History smoke: a temp folder with two hand-written transcripts, a `--runtime fake` daemon
 * indexing it, a search for a term only the second one has, `history.resume` of that session
 * (the FakeRuntime must get `resume` with its id) and `history.changed` when the first grows.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";

// The daemon inherits PATH and HOME: neither the real `claude` nor `~/.claude` (docs/TDD.md).
const guard = installClaudeGuard();
const home = installHomeGuard();
const TIMEOUT_MS = 10_000;
const ROOT = resolve(import.meta.dir, "..");
const FIRST = "aaaaaaaa-0000-4000-8000-000000000001";
const SECOND = "bbbbbbbb-0000-4000-8000-000000000002";
const TERM = "zebralho";

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(20);
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  frames: ServerMessage[] = [];

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else this.frames.push(parsed);
    });
    await withTimeout(
      new Promise<void>((ok, fail) => {
        this.ws.addEventListener("open", () => ok(), { once: true });
        this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
          once: true,
        });
      }),
      "conectar",
    );
    await this.call("hello", { token, client: "smoke-history" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): void {
    this.ws.close();
  }
}

const line = (uuid: string, cwd: string, text: string, ts: string) =>
  `${JSON.stringify({ type: "user", cwd, uuid, timestamp: ts, message: { role: "user", content: text } })}\n`;

async function readListenUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const match = buffer.match(/listening on (ws:\/\/\S+)/);
    if (match?.[1]) return match[1];
  }
  throw new Error(`daemon saiu sem anunciar a porta: ${buffer}`);
}

async function run(work: string): Promise<void> {
  const projectRoot = join(work, "projects");
  const projectA = join(projectRoot, "projeto-a");
  const projectB = join(projectRoot, "projeto-b");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  // Imitates ~/.claude/projects: one directory per project, one file per session.
  const transcripts = join(work, "claude-projects");
  mkdirSync(join(transcripts, "-projeto-a"), { recursive: true });
  mkdirSync(join(transcripts, "-projeto-b"), { recursive: true });
  const firstFile = join(transcripts, "-projeto-a", `${FIRST}.jsonl`);
  writeFileSync(firstFile, line("u1", projectA, "primeira conversa", "2026-09-01T10:00:00.000Z"));
  const secondFile = join(transcripts, "-projeto-b", `${SECOND}.jsonl`);
  writeFileSync(
    secondFile,
    line("u1", projectB, `segunda conversa com ${TERM}`, "2026-09-02T10:00:00.000Z"),
  );
  // Finished an hour ago, so it is not `maybeActive` and resumes without `force`.
  const anHourAgo = new Date(Date.now() - 3_600_000);
  utimesSync(secondFile, anHourAgo, anHourAgo);

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-history",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projectRoot],
      runtime: "fake",
      history: { roots: [transcripts], scanIntervalMs: 200 },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [
      process.execPath,
      "run",
      join(ROOT, "apps/daemon/src/bin.ts"),
      "start",
      "--config",
      configPath,
      "--runtime",
      "fake",
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "esperar a indexação";
    let listed = 0;
    const deadline = Date.now() + TIMEOUT_MS;
    while (listed < 2 && Date.now() < deadline) {
      const { sessions } = await client.call<{ sessions: unknown[] }>("history.list", {
        limit: 10,
      });
      listed = sessions.length;
      if (listed < 2) await Bun.sleep(50);
    }
    if (listed !== 2) throw new Error(`esperava 2 sessões indexadas, veio ${listed}`);
    log("dois transcripts indexados");

    step = "buscar um termo que só existe no segundo";
    const { hits } = await client.call<{
      hits: Array<{ claudeSessionId: string; snippet: string }>;
    }>("history.search", { query: TERM, limit: 10 });
    if (hits.length !== 1 || hits[0]?.claudeSessionId !== SECOND) {
      throw new Error(`busca devolveu ${JSON.stringify(hits)}`);
    }
    log(`acerto: ${hits[0].snippet}`);

    step = "retomar a sessão encontrada";
    const { sessionId } = await client.call<{ sessionId: string }>("history.resume", {
      claudeSessionId: SECOND,
    });
    await client.call("session.subscribe", { sessionId });
    await client.call("session.send", { sessionId, text: "continuando" });
    // The FakeRuntime reports the id it was started with (`resume`) in session.init.
    const init = await until(
      () =>
        client.frames.find(
          (f) => f.type === "event" && f.sessionId === sessionId && f.event.type === "session.init",
        ),
      "session.init da sessão retomada",
    );
    const resumed = init.type === "event" && init.event.type === "session.init" ? init.event : null;
    if (resumed?.claudeSessionId !== SECOND) {
      throw new Error(`o runtime recebeu resume=${resumed?.claudeSessionId}, esperava ${SECOND}`);
    }
    log(`FakeRuntime retomou ${SECOND}`);

    step = "history.changed quando o primeiro cresce";
    await client.call("history.watch", {});
    appendFileSync(firstFile, line("u2", projectA, "mais uma linha", "2026-09-03T10:00:00.000Z"));
    const changed = await until(
      () => client.frames.find((f) => f.type === "history.changed" && f.claudeSessionId === FIRST),
      "history.changed do primeiro transcript",
    );
    log(`history.changed: ${JSON.stringify(changed)}`);
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

const work = mkdtempSync(join(tmpdir(), "flightdeck-smoke-history-"));
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertHomeGuard(home);
  console.log("SMOKE HISTORY OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE HISTORY FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
