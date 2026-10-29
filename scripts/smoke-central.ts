#!/usr/bin/env bun
/**
 * Session hub smoke: a `--runtime fake` daemon with a temporary HOME, `hooks.install` through the
 * protocol, and a session opened by `flightdeckd claude` with the fake claude, which fires
 * SessionStart and UserPromptSubmit, writes the transcript and asks permission for a Write. The
 * smoke checks the external session (controllable, in its project group), approves the request,
 * sends a message through the channel, sees history.changed, waits for SessionEnd and finally
 * uninstalls the hooks, leaving settings.json as it was.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import { type FakeClaudeEvent, installFakeClaude } from "../apps/daemon/test/fake-claude.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";

// The daemon, the wrapper and the fake claude inherit PATH and HOME: none of the real claude,
// gh, az or ~/.claude is reachable.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
assertCliGuardActive(clis);

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const SESSION = "cccccccc-0000-4000-8000-000000000003";

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
    await this.call("hello", { token, client: "smoke-central" });
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

function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, env: process.env, stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
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

interface External {
  claudeSessionId: string;
  status: string;
  controllable: boolean;
  projectKey: string | null;
  meta?: { name: string | null };
}

const events = (all: FakeClaudeEvent[], type: string) => all.filter((e) => e.type === type);

async function run(work: string): Promise<void> {
  const project = join(work, "projeto");
  mkdirSync(project, { recursive: true });
  git(project, "init", "-q", "-b", "main");
  git(project, "remote", "add", "origin", "git@github.com:Acme/Smoke.git");

  // The user's settings before Flightdeck: another key and a third-party hook.
  const settingsFile = join(homedir(), ".claude", "settings.json");
  const original = {
    model: "opus",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo terceiro" }] }] },
  };
  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(original, null, 2));

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-central",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0 },
      history: { scanIntervalMs: 200 },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const fake = installFakeClaude([
    { do: "channel" },
    { do: "session-start", sessionId: SESSION },
    { do: "hook", event: "UserPromptSubmit", payload: { prompt: "crie a.txt" } },
    { do: "transcript", text: "crie a.txt" },
    {
      do: "hook",
      event: "PermissionRequest",
      payload: {
        tool_name: "Write",
        tool_input: { file_path: "a.txt", content: "oi" },
        permission_suggestions: [],
      },
    },
    { do: "wait-channel", count: 1 },
    { do: "transcript", text: "linha nova depois da mensagem" },
    { do: "hook", event: "Stop" },
    { do: "hook", event: "SessionEnd", payload: { reason: "exit" } },
    { do: "exit", code: 0 },
  ]);
  let wrapper: ReturnType<typeof Bun.spawn> | null = null;
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);
    await client.call("external.watch", {});
    await client.call("history.watch", {});

    step = "instalar hooks";
    const installed = await client.call<{ status: string; receptorUrl: string }>("hooks.install", {
      confirm: true,
    });
    if (installed.status !== "installed") throw new Error(`hooks: ${installed.status}`);
    log(`hooks instalados, receptor em ${installed.receptorUrl}`);

    step = "abrir flightdeckd claude";
    wrapper = Bun.spawn([process.execPath, "run", BIN, "claude", "-p", "crie a.txt"], {
      cwd: project,
      env: { ...process.env, FLIGHTDECK_CONFIG: configPath },
      stdout: "inherit",
      stderr: "inherit",
    });
    const request = await until(
      () =>
        client.frames.find(
          (f) => f.type === "external.permission" && f.state === "open" && f.toolName === "Write",
        ),
      "pedido de permissão do Write",
    );

    step = "conferir a sessão externa";
    await until(
      () =>
        client.frames.find(
          (f) =>
            f.type === "external.updated" &&
            f.session.claudeSessionId === SESSION &&
            f.session.controllable,
        ),
      "sessão externa controlável",
    );
    const { sessions } = await client.call<{ sessions: External[] }>("external.list", {});
    const external = sessions.find((s) => s.claudeSessionId === SESSION);
    if (!external?.controllable) throw new Error("sessão externa não está controlável");
    if (external.projectKey !== "github.com/acme/smoke") {
      throw new Error(`projeto ${external.projectKey}`);
    }
    log(`sessão ${SESSION}: controlável, projeto ${external.projectKey}`);

    step = "renomear a sessão";
    await client.call("session.meta.set", { claudeSessionId: SESSION, name: "Sessão do smoke" });
    const renamed = await client.call<{ sessions: External[] }>("external.list", {});
    const name = renamed.sessions.find((s) => s.claudeSessionId === SESSION)?.meta?.name;
    if (name !== "Sessão do smoke") throw new Error(`nome ${name}`);
    log("renomeada pelo session.meta.set");

    step = "aprovar o pedido";
    if (request.type !== "external.permission") throw new Error("pedido inesperado");
    await client.call("permission.respond", { requestId: request.requestId, decision: "allow" });
    const answer = await until(
      () => events(fake.events(), "hook").find((e) => e.event === "PermissionRequest"),
      "resposta do hook de permissão",
    );
    if (!String(answer.body).includes('"behavior":"allow"')) {
      throw new Error(`hook respondeu ${answer.body}`);
    }
    log("Write aprovado pelo app");

    step = "mandar mensagem pelo canal";
    await client.call("external.message", { claudeSessionId: SESSION, text: "mensagem do app" });
    const delivered = await until(
      () => events(fake.events(), "channel")[0],
      "mensagem no canal do claude falso",
    );
    const params = (delivered.notification as { params?: { content?: string } }).params;
    if (params?.content !== "mensagem do app") throw new Error(`canal recebeu ${params?.content}`);
    log("mensagem entregue pelo canal");

    step = "history.changed com a linha nova";
    await until(
      () =>
        client.frames.find((f) => f.type === "history.changed" && f.claudeSessionId === SESSION),
      "history.changed da sessão externa",
    );
    const page = await client.call<{ messages: Array<{ text: string }> }>("history.get", {
      claudeSessionId: SESSION,
    });
    const texts = page.messages.map((m) => m.text);
    if (!texts.some((t) => t.includes("crie a.txt"))) throw new Error(`transcript: ${texts}`);
    log("history.changed recebido");

    step = "esperar SessionEnd";
    await until(
      () =>
        client.frames.find(
          (f) =>
            f.type === "external.updated" &&
            f.session.claudeSessionId === SESSION &&
            f.session.status === "ended",
        ),
      "sessão encerrada",
    );
    const code = await withTimeout(wrapper.exited, "flightdeckd claude terminar");
    if (code !== 0) throw new Error(`flightdeckd claude saiu com ${code}`);
    log("sessão encerrada e flightdeckd claude saiu com 0");

    step = "remover hooks";
    await client.call("hooks.uninstall", { confirm: true });
    const after = JSON.parse(readFileSync(settingsFile, "utf8"));
    if (JSON.stringify(after) !== JSON.stringify(original)) {
      throw new Error(`settings.json mudou: ${JSON.stringify(after)}`);
    }
    log("settings.json igual ao original");
    client.close();
  } finally {
    wrapper?.kill();
    daemon.kill();
    await daemon.exited;
    fake.restore();
  }
}

const work = mkdtempSync(join(tmpdir(), "flightdeck-smoke-central-"));
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  console.log("SMOKE CENTRAL OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE CENTRAL FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
