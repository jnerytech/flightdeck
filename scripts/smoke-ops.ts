#!/usr/bin/env bun
/**
 * Host operations smoke: a `--runtime fake` daemon with `retention.eventsDays: 0`, one live and
 * one ended session, `maintenance.backup` (an intact copy with the same `user_version`),
 * `maintenance.prune` (the ended session loses its events, the live one keeps them), a `hello`
 * from an incompatible protocol, `features` in `host.info`, and `flightdeckd restore` of the
 * backup with the daemon stopped, after which the pruned conversation is back.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type Ack,
  CLOSE_UNAUTHORIZED,
  PROTOCOL_VERSION,
  parseServerMessage,
} from "@flightdeck/protocol";
import { assertBinaryUntouched, installBinaryGuard } from "./test/binary-guard.ts";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon inherits PATH and HOME: neither the real `claude` nor `~/.claude` (docs/TDD.md).
const guard = installClaudeGuard();
const home = installHomeGuard();
const binary = installBinaryGuard(dirname(home.realClaude));
// The daemon of this smoke runs no workflow: any check reaching its shell is refused.
const checks = installCheckGuard();
assertCheckGuardActive(checks);
const clis = installCliGuard();
assertCliGuardActive(clis);
// Nothing here may reach systemctl, schtasks or loginctl.
const serviceGuard = join(mkdtempSync(join(tmpdir(), "fd-service-guard-")), "calls.log");
process.env.FLIGHTDECK_SERVICE_GUARD = serviceGuard;
const TIMEOUT_MS = 10_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");

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

class Client {
  private ws!: WebSocket;
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  /** Close code once the daemon drops the connection. */
  closed!: Promise<number>;

  constructor(private readonly url: string) {}

  /** Connects and says hello; returns the hello's ack (failed or not). */
  async open(token: string, protocolVersion = PROTOCOL_VERSION): Promise<Ack> {
    this.ws = new WebSocket(this.url);
    this.closed = new Promise((ok) => this.ws.addEventListener("close", (e) => ok(e.code)));
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
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
    return this.send("hello", { token, client: "smoke-ops", protocolVersion });
  }

  send(type: string, payload: unknown): Promise<Ack> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return withTimeout(ack, `ack de ${type}`);
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const result = await this.send(type, payload);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): void {
    this.ws.close();
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

function startDaemon(configPath: string) {
  // `env` explicitly: without it the daemon would get the environment from before the guards.
  return Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
}

interface SessionRow {
  id: string;
  status: string;
}

async function waitStatus(client: Client, sessionId: string, status: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const { sessions } = await client.call<{ sessions: SessionRow[] }>("session.list", {});
    if (sessions.find((s) => s.id === sessionId)?.status === status) return;
    if (Date.now() > deadline) throw new Error(`timeout: sessão ${sessionId} em ${status}`);
    await Bun.sleep(50);
  }
}

const replayed = async (client: Client, sessionId: string) => {
  const result = await client.call<{ replayed: number }>("session.subscribe", {
    sessionId,
    sinceSeq: 0,
  });
  await client.call("session.unsubscribe", { sessionId });
  return result.replayed;
};

const userVersion = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
};

async function run(work: string): Promise<void> {
  const project = join(work, "projeto");
  mkdirSync(project, { recursive: true });
  const dataDir = join(work, "data");
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-ops",
      port: 0,
      token,
      dataDir,
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0 },
      retention: { eventsDays: 0, externalSessionsDays: 0 },
    }),
  );

  step = "subir daemon";
  let daemon = startDaemon(configPath);
  let backupPath = "";
  let ended = "";
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    const hello = await client.open(token);
    if (!hello.ok) throw new Error(`hello recusado: ${JSON.stringify(hello)}`);

    step = "host.info traz features";
    const info = await client.call<{ features?: string[] }>("host.info", {});
    if (!info.features?.includes("maintenance")) {
      throw new Error(`features sem maintenance: ${JSON.stringify(info.features)}`);
    }
    log(`features: ${info.features.join(", ")}`);

    step = "hello de um protocolo incompatível";
    const stranger = new Client(url);
    const refused = await stranger.open(token, 999);
    if (refused.ok || refused.error.code !== "protocol_incompatible") {
      throw new Error(`esperava protocol_incompatible, veio ${JSON.stringify(refused)}`);
    }
    // Still unauthenticated: anything but a hello closes it as unauthorized.
    void stranger.send("host.info", {}).catch(() => {});
    const closeCode = await withTimeout(stranger.closed, "fechar a conexão incompatível");
    if (closeCode !== CLOSE_UNAUTHORIZED) {
      throw new Error(`conexão incompatível fechou com ${closeCode}`);
    }
    log(`recusado: ${refused.error.message}`);

    step = "criar uma sessão viva e uma encerrada";
    const live = await client.call<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "fica viva",
      name: "viva",
    });
    const old = await client.call<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "vai encerrar",
      name: "encerrada",
    });
    ended = old.sessionId;
    await waitStatus(client, live.sessionId, "idle");
    await waitStatus(client, ended, "idle");
    await client.call("session.close", { sessionId: ended });
    await waitStatus(client, ended, "ended");
    const before = await replayed(client, ended);
    if (before === 0) throw new Error("a sessão encerrada não tem eventos");
    log(`sessão encerrada com ${before} eventos`);

    step = "maintenance.backup";
    const backup = await client.call<{ path: string; bytes: number }>("maintenance.backup", {});
    backupPath = backup.path;
    const copy = new Database(backup.path, { readonly: true });
    const integrity = (copy.query("PRAGMA integrity_check").get() as { integrity_check: string })
      .integrity_check;
    copy.close();
    if (integrity !== "ok") throw new Error(`backup com integridade ${integrity}`);
    const liveVersion = userVersion(join(dataDir, "flightdeck.db"));
    if (userVersion(backup.path) !== liveVersion) {
      throw new Error(`user_version ${userVersion(backup.path)} ≠ ${liveVersion}`);
    }
    log(`backup ${backup.path} (${backup.bytes} bytes, user_version ${liveVersion})`);

    step = "maintenance.prune";
    const counts = await client.call<Record<string, number>>("maintenance.prune", {});
    if ((counts.events ?? 0) < before) throw new Error(`prune: ${JSON.stringify(counts)}`);
    if ((await replayed(client, ended)) !== 0) throw new Error("eventos da encerrada ficaram");
    if ((await replayed(client, live.sessionId)) === 0) throw new Error("a viva perdeu eventos");
    log(`limpeza: ${JSON.stringify(counts)}; a sessão viva continua com seus eventos`);
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }

  step = "restore com o daemon parado";
  const restore = Bun.spawn(
    [process.execPath, "run", BIN, "restore", backupPath, "--config", configPath],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(restore.stdout).text(),
    new Response(restore.stderr).text(),
    restore.exited,
  ]);
  if (code !== 0) throw new Error(`restore saiu com ${code}: ${out}${err}`);
  log(out.trim());
  // The backup came before the cleanup: the file now holds the conversation again (the next
  // boot prunes it once more, since this config keeps ended sessions for 0 days).
  const restored = new Database(join(dataDir, "flightdeck.db"), { readonly: true });
  const { n } = restored
    .query("SELECT COUNT(*) AS n FROM events WHERE session_id = ?")
    .get(ended) as { n: number };
  restored.close();
  if (n === 0) throw new Error("o banco restaurado não tem a conversa do backup");
  log(`banco restaurado com ${n} eventos da sessão encerrada`);

  step = "subir de novo e encontrar a sessão";
  daemon = startDaemon(configPath);
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    const client = new Client(url);
    await client.open(token);
    const { sessions } = await client.call<{ sessions: SessionRow[] }>("session.list", {});
    if (!sessions.some((s) => s.id === ended)) throw new Error("sessão sumiu depois do restore");
    log(`sessão ${ended} encontrada depois do restore`);
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

const work = realTempDir("flightdeck-smoke-ops-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  assertNoCliCalls(clis);
  assertBinaryUntouched(binary);
  if (existsSync(serviceGuard)) {
    throw new Error(`controlador de serviço real chamado: ${readFileSync(serviceGuard, "utf8")}`);
  }
  console.log("SMOKE OPS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE OPS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
