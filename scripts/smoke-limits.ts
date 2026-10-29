#!/usr/bin/env bun
/**
 * Limits smoke: a `--runtime fake` daemon with a temporary project. A `[ratelimit:…]` message
 * gives `quota.updated`; a card started next waits in the queue with reason `quota` and starts
 * by itself once the window resets. Its Bash request (with suggestions) is answered with a
 * project rule, which reaches the runtime and the root `.claude/settings.local.json`, after a
 * `setMode bypassPermissions` answer is refused with `invalid_permission_update`. Then the fake
 * claude of phase 5 sends a `PermissionRequest` with `permission_suggestions`, answered with one
 * of them: the hook's answer carries `updatedPermissions`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import { type FakeClaudeEvent, installFakeClaude } from "../apps/daemon/test/fake-claude.ts";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";

// The daemon gets this environment: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCliGuardActive(clis);
assertCheckGuardActive(checks);
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const SESSION = "dddddddd-0000-4000-8000-000000000007";
const SETTINGS = join(".claude", "settings.local.json");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

interface Card {
  id: string;
  queued: boolean;
  queueReason: string | null;
  sessionId: string | null;
}

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
    await this.call("hello", { token, client: "smoke-limits" });
  }

  /** The ack itself, ok or not. */
  async request(type: string, payload: unknown): Promise<Ack> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    return withTimeout(ack, `ack de ${type}`);
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const result = await this.request(type, payload);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  card(id: string, check: (card: Card) => boolean): Card | undefined {
    return this.frames
      .flatMap((f) => (f.type === "card.updated" && f.card.id === id ? [f.card as Card] : []))
      .filter(check)
      .at(-1);
  }

  close(): void {
    this.ws.close();
  }
}

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
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

const SUGGESTIONS = [
  { type: "addDirectories", directories: ["novo"], destination: "session" },
  { type: "setMode", mode: "acceptEdits", destination: "session" },
];

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-limits",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      hooks: { port: 0 },
      quota: { pauseAt: 0.9 },
      history: { roots: [join(work, "sem-historico")] },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const fake = installFakeClaude([
    { do: "session-start", sessionId: SESSION },
    {
      do: "hook",
      event: "PermissionRequest",
      payload: {
        tool_name: "Bash",
        tool_input: { command: "mkdir novo" },
        permission_suggestions: SUGGESTIONS,
      },
    },
    { do: "hook", event: "SessionEnd", payload: { reason: "exit" } },
    { do: "exit", code: 0 },
  ]);
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);
    await client.call("quota.watch", {});
    await client.call("board.watch", {});
    await client.call("external.watch", {});

    step = "ler a cota";
    const resets = Math.floor(Date.now() / 1000) + 3;
    await client.call("session.create", {
      cwd: repo,
      prompt: `oi [ratelimit:five_hour=0.95@${resets}]`,
    });
    const reading = await until(
      () =>
        client.frames.find(
          (f) => f.type === "quota.updated" && f.windows.some((w) => w.utilization === 0.95),
        ),
      "quota.updated com five_hour em 95%",
    );
    if (reading.type !== "quota.updated") throw new Error("frame inesperado");
    log(`quota.updated: ${reading.windows.map((w) => `${w.window} ${w.utilization}`).join(", ")}`);

    step = "card na fila por cota";
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      promptTemplate: "",
    });
    const created = await client.call<Card>("card.create", {
      projectId: project.id,
      title: "Testes",
      description: "rode os testes [bash]",
    });
    const queued = await client.call<Card>("card.start", { cardId: created.id });
    if (!queued.queued || queued.queueReason !== "quota") {
      throw new Error(`card não ficou na fila por cota: ${JSON.stringify(queued)}`);
    }
    log("card na fila com motivo quota");
    const started = await until(
      () => client.card(created.id, (c) => c.sessionId !== null),
      "card começar depois do reinício da janela",
    );
    log("a janela reiniciou e o card começou sozinho");

    step = "responder com regra do projeto";
    await client.call("session.subscribe", { sessionId: started.sessionId });
    const request = await until(
      () =>
        client.frames.find(
          (f) =>
            f.type === "event" &&
            f.sessionId === started.sessionId &&
            f.event.type === "permission.requested",
        ),
      "pedido de permissão do Bash",
    );
    if (request.type !== "event" || request.event.type !== "permission.requested") {
      throw new Error("pedido inesperado");
    }
    if (!request.event.suggestions?.length) throw new Error("pedido sem sugestões");
    const requestId = request.event.requestId;
    const bypass = await client.request("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }],
    });
    if (bypass.ok || bypass.error.code !== "invalid_permission_update") {
      throw new Error(`bypassPermissions não foi recusado: ${JSON.stringify(bypass)}`);
    }
    log("setMode bypassPermissions recusado com invalid_permission_update");
    const rule = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
      behavior: "allow",
      destination: "localSettings",
    };
    await client.call("permission.respond", {
      requestId,
      decision: "allow",
      updatedPermissions: [rule],
    });
    const result = await until(
      () =>
        client.frames.find(
          (f) =>
            f.type === "event" &&
            f.sessionId === started.sessionId &&
            f.event.type === "tool.result",
        ),
      "resultado do Bash",
    );
    const content =
      result.type === "event" && result.event.type === "tool.result" ? result.event.content : "";
    if (!content.includes("npm test:*"))
      throw new Error(`a regra não chegou ao runtime: ${content}`);
    const settings = join(repo, SETTINGS);
    const allow = existsSync(settings)
      ? JSON.parse(readFileSync(settings, "utf8")).permissions?.allow
      : null;
    if (JSON.stringify(allow) !== JSON.stringify(["Bash(npm test:*)"])) {
      throw new Error(`settings.local.json da raiz: ${JSON.stringify(allow)}`);
    }
    log("regra Bash(npm test:*) no runtime e no settings.local.json da raiz");

    step = "permissão do claude do terminal";
    const installed = await client.call<{ status: string }>("hooks.install", { confirm: true });
    if (installed.status !== "installed") throw new Error(`hooks: ${installed.status}`);
    const claude = Bun.spawn(
      [join(fake.dir, process.platform === "win32" ? "claude.cmd" : "claude")],
      {
        cwd: repo,
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const held = await until(
      () => client.frames.find((f) => f.type === "external.permission" && f.state === "open"),
      "pedido do PermissionRequest",
    );
    if (held.type !== "external.permission" || held.suggestions?.length !== 2) {
      throw new Error(`sugestões do hook: ${JSON.stringify(held)}`);
    }
    await client.call("permission.respond", {
      requestId: held.requestId,
      decision: "allow",
      updatedPermissions: [held.suggestions[0]],
    });
    const answer = await until(
      () =>
        fake
          .events()
          .find((e: FakeClaudeEvent) => e.type === "hook" && e.event === "PermissionRequest"),
      "resposta do hook",
    );
    const decision = JSON.parse(String(answer.body)).hookSpecificOutput?.decision;
    if (JSON.stringify(decision?.updatedPermissions) !== JSON.stringify([SUGGESTIONS[0]])) {
      throw new Error(`o hook respondeu ${answer.body}`);
    }
    log("a resposta do hook trouxe updatedPermissions");
    await withTimeout(claude.exited, "claude falso terminar");
    await client.call("hooks.uninstall", { confirm: true });
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    fake.restore();
  }
}

const work = mkdtempSync(join(tmpdir(), "flightdeck-smoke-limits-"));
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE LIMITS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE LIMITS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
