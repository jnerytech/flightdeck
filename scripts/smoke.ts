#!/usr/bin/env bun
/**
 * End-to-end smoke test. Starts the real daemon process with `--runtime fake` on a free port and
 * temporary data, drives it with a real WebSocket client and checks replay after a reconnect.
 *
 * `--real` runs the same script against `--runtime claude` in a throwaway folder (manual only;
 * it spends quota and is not part of the acceptance criteria).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, type EventEnvelope, parseServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

const REAL = process.argv.includes("--real");
// The daemon inherits this PATH: with the fake runtime, `claude` must never run (docs/TDD.md).
const guard = REAL ? null : installClaudeGuard();
// Same for the real `~/.claude`: the daemon resolves `~` from the HOME it inherits.
const home = REAL ? null : installHomeGuard();
// The daemon of these smokes runs no workflow: any check reaching its shell is refused.
const checks = REAL ? null : installCheckGuard();
if (checks) assertCheckGuardActive(checks);
// And for the PR CLIs: nothing here may reach the real `gh` or `az`.
const clis = REAL ? null : installCliGuard();
if (clis) assertCliGuardActive(clis);
const TIMEOUT_MS = REAL ? 180_000 : 10_000;
const ROOT = resolve(import.meta.dir, "..");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  events: EventEnvelope[] = [];
  closed = false;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "event") this.events.push(parsed);
      else if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
    });
    this.ws.addEventListener("close", () => {
      this.closed = true;
    });
    return new Promise((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), { once: true });
    });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): Promise<void> {
    this.ws.close();
    return until(() => this.closed, "fechar conexão");
  }
}

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

const persisted = (events: EventEnvelope[]) =>
  events.filter((e) => e.event.type !== "message.delta");
const count = (events: EventEnvelope[], type: string) =>
  events.filter((e) => e.event.type === type).length;

async function run(): Promise<void> {
  const work = realTempDir("flightdeck-smoke-");
  const projectRoot = join(work, "projects");
  const project = join(projectRoot, "demo");
  mkdirSync(project, { recursive: true });
  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projectRoot],
      runtime: REAL ? "claude" : "fake",
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
      REAL ? "claude" : "fake",
    ],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );

  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);

    step = "hello";
    const client = new Client(url);
    await client.open();
    const hello = await client.call<{ hostName: string; protocolVersion: number }>("hello", {
      token,
      client: "smoke",
    });
    if (hello.hostName !== "smoke" || hello.protocolVersion !== 1)
      throw new Error("hello inesperado");

    step = "criar sessão";
    const firstPrompt = REAL ? "Responda apenas: ok" : "olá, smoke";
    const { sessionId } = await client.call<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: firstPrompt,
      name: "smoke",
    });
    await client.call("session.subscribe", { sessionId, sinceSeq: 0 });

    step = "receber resposta";
    await until(() => count(client.events, "turn.result") >= 1, "primeiro turn.result");
    if (count(client.events, "message.assistant") < 1) throw new Error("sem message.assistant");
    log("primeira resposta recebida");

    step = "pedir ferramenta";
    const toolPrompt = REAL
      ? "Crie o arquivo smoke.txt nesta pasta com o conteúdo 'ok'. Use a ferramenta Write."
      : "agora use [tool]";
    await client.call("session.send", { sessionId, text: toolPrompt });
    await until(() => count(client.events, "permission.requested") >= 1, "permission.requested");
    const request = client.events.find((e) => e.event.type === "permission.requested");
    if (request?.event.type !== "permission.requested") throw new Error("pedido não encontrado");
    log(`permissão pedida para ${request.event.toolName}`);

    step = "aprovar";
    await client.call("permission.respond", {
      requestId: request.event.requestId,
      decision: "allow",
    });
    await until(() => count(client.events, "turn.result") >= 2, "segundo turn.result");
    log("turno com ferramenta concluído");

    step = "derrubar conexão";
    const lastSeen = Math.max(...persisted(client.events).map((e) => e.seq));
    await client.close();

    step = "eventos durante a queda";
    const other = new Client(url);
    await other.open();
    await other.call("hello", { token, client: "smoke-2" });
    await other.call("session.send", {
      sessionId,
      text: REAL ? "Responda apenas: fim" : "durante a queda",
    });
    await other.call("session.subscribe", { sessionId, sinceSeq: lastSeen });
    await until(() => count(other.events, "turn.result") >= 1, "turno durante a queda");
    await until(
      () =>
        other.events.some((e) => e.event.type === "session.status" && e.event.status === "idle"),
      "idle após a queda",
    );
    await other.close();

    step = "reconectar com sinceSeq";
    const back = new Client(url);
    await back.open();
    await back.call("hello", { token, client: "smoke" });
    const sub = await back.call<{ session: { lastSeq: number }; replayed: number }>(
      "session.subscribe",
      {
        sessionId,
        sinceSeq: lastSeen,
      },
    );
    await until(() => back.events.length >= sub.replayed, "replay");

    step = "conferir replay";
    const seqs = back.events.map((e) => e.seq);
    const expected = Array.from(
      { length: sub.session.lastSeq - lastSeen },
      (_, i) => lastSeen + 1 + i,
    );
    if (JSON.stringify(seqs) !== JSON.stringify(expected)) {
      throw new Error(
        `replay com buraco ou duplicado: esperado ${expected.join(",")}, veio ${seqs.join(",")}`,
      );
    }
    if (!back.events.some((e) => e.event.type === "message.user" && e.event.text.length > 0)) {
      throw new Error("replay sem a mensagem enviada durante a queda");
    }
    log(`replay de ${seqs.length} eventos (seq ${lastSeen + 1}..${sub.session.lastSeq})`);

    step = "encerrar sessão";
    await back.call("session.close", { sessionId });
    await back.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      // The SQLite files may still be locked on Windows for a moment; temp dir is fine to keep.
    }
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

try {
  await run();
  if (guard) assertNoClaudeCalls(guard);
  if (home) assertHomeGuard(home);
  if (checks) assertNoRefusedChecks(checks);
  if (clis) assertNoCliCalls(clis);
  console.log("SMOKE OK");
  process.exit(0);
} catch (error) {
  console.error(
    `SMOKE FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
