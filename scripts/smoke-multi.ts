#!/usr/bin/env bun
/**
 * Multi-host smoke: two `--runtime fake` daemons with their own port and dataDir, one client
 * connected to both. A permission request on the second host must show up through
 * `session.summary`; after approving it, both sessions finish their turn.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Ack,
  type EventEnvelope,
  parseServerMessage,
  type SessionEventOf,
} from "@flightdeck/protocol";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";

// The daemons inherit this PATH: with the fake runtime, `claude` must never run (docs/TDD.md).
const guard = installClaudeGuard();
// Same for the real `~/.claude`: the daemons resolve `~` from the HOME they inherit.
const home = installHomeGuard();
// And for the PR CLIs: nothing here may reach the real `gh` or `az`.
const clis = installCliGuard();
assertCliGuardActive(clis);
const TIMEOUT_MS = 10_000;
const ROOT = resolve(import.meta.dir, "..");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);
type Summary = SessionEventOf<"session.summary">;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`timeout: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(10);
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  events: EventEnvelope[] = [];

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "event") this.events.push(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
    });
    await withTimeout(
      new Promise<void>((ok, fail) => {
        this.ws.addEventListener("open", () => ok(), { once: true });
        this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
          once: true,
        });
      }),
      `conectar em ${this.url}`,
    );
    await this.call("hello", { token, client: "smoke-multi" });
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

interface FakeDaemon {
  url: string;
  token: string;
  project: string;
  stop(): Promise<void>;
}

async function startFakeDaemon(name: string): Promise<FakeDaemon> {
  const work = mkdtempSync(join(tmpdir(), `flightdeck-smoke-${name}-`));
  const projectRoot = join(work, "projects");
  const project = join(projectRoot, "demo");
  mkdirSync(project, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: name,
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projectRoot],
      runtime: "fake",
    }),
  );
  const proc = Bun.spawn(
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
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const stop = async () => {
    proc.kill();
    await proc.exited;
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
    }
  };
  try {
    const url = await withTimeout(readListenUrl(proc.stdout), `${name} anunciar a porta`);
    return { url, token, project, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

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

const summaries = (events: EventEnvelope[], sessionId: string) =>
  events.flatMap((e) =>
    e.event.type === "session.summary" && e.sessionId === sessionId ? [e.event as Summary] : [],
  );
const results = (events: EventEnvelope[], sessionId: string) =>
  events.filter((e) => e.sessionId === sessionId && e.event.type === "turn.result").length;

async function run(daemons: FakeDaemon[]): Promise<void> {
  step = "subir dois daemons";
  daemons.push(await startFakeDaemon("host-a"), await startFakeDaemon("host-b"));
  const [a, b] = daemons as [FakeDaemon, FakeDaemon];
  if (a.url === b.url) throw new Error("os dois daemons estão na mesma porta");
  log(`host-a em ${a.url}, host-b em ${b.url}`);

  step = "conectar nos dois";
  const ca = new Client(a.url);
  const cb = new Client(b.url);
  await ca.open(a.token);
  await cb.open(b.token);

  step = "sessions.watch";
  await ca.call("sessions.watch", {});
  await cb.call("sessions.watch", {});

  step = "abrir uma sessão em cada";
  const sa = await ca.call<{ sessionId: string }>("session.create", {
    cwd: a.project,
    prompt: "olá A",
  });
  const sb = await cb.call<{ sessionId: string }>("session.create", {
    cwd: b.project,
    prompt: "[tool] B",
  });
  await ca.call("session.subscribe", { sessionId: sa.sessionId });
  await cb.call("session.subscribe", { sessionId: sb.sessionId });

  step = "pedido de permissão no segundo via session.summary";
  await until(
    () => summaries(cb.events, sb.sessionId).some((s) => s.pendingPermissions.length === 1),
    "session.summary com pedido aberto no host-b",
  );
  const pending = summaries(cb.events, sb.sessionId).find((s) => s.pendingPermissions.length === 1);
  const request = pending?.pendingPermissions[0];
  if (!request) throw new Error("resumo sem o pedido");
  log(`host-b pede ${request.toolName} (${request.requestId})`);

  step = "aprovar";
  await cb.call("permission.respond", { requestId: request.requestId, decision: "allow" });

  step = "esperar os dois turn.result";
  await until(() => results(ca.events, sa.sessionId) >= 1, "turn.result no host-a");
  await until(() => results(cb.events, sb.sessionId) >= 1, "turn.result no host-b");
  await until(
    () => summaries(cb.events, sb.sessionId).at(-1)?.status === "idle",
    "resumo idle no host-b",
  );
  log("os dois hosts concluíram o turno");
  ca.close();
  cb.close();
}

const daemons: FakeDaemon[] = [];
let code = 1;
try {
  await run(daemons);
  step = "trava do claude";
  assertNoClaudeCalls(guard);
  step = "trava de home";
  assertHomeGuard(home);
  step = "trava de CLIs";
  assertNoCliCalls(clis);
  console.log("SMOKE MULTI OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE MULTI FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  await Promise.all(daemons.map((d) => d.stop()));
}
process.exit(code);
