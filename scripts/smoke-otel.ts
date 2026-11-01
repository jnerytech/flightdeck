#!/usr/bin/env bun
/**
 * Telemetry smoke (phase 23): a `--runtime fake` daemon with the hooks token and the OTLP receiver
 * on a free port, and a session opened by `flightdeckd claude` with the fake claude, which sends
 * OTLP logs (a prompt with API requests, a permission a person answered, a tool, an API error)
 * using the variables the wrapper gave it. The smoke checks that those variables carry no content
 * flag, that a request with a wrong token is refused, and that the timeline, the permission wait
 * and the cost add up. `~/.claude/settings.json` is never written.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { realTempDir, testHome } from "./test/temp-dir.ts";

// The daemon, the wrapper and the fake claude inherit PATH and HOME: none of the real claude,
// gh, az or ~/.claude is reachable.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
// The daemon of this smoke runs no workflow: any check reaching its shell is refused.
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const SESSION = "cccccccc-0000-4000-8000-000000000023";

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
  private readonly acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  readonly frames: ServerMessage[] = [];

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
    await this.call("hello", { token, client: "smoke-otel" });
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

const events = (all: FakeClaudeEvent[], type: string) => all.filter((e) => e.type === type);

interface Item {
  kind: string;
  toolName: string | null;
  waitMs: number | null;
  durationMs: number | null;
}
interface Prompt {
  promptId: string | null;
  costUsd: number;
  waitMs: number;
  items: Item[];
}

async function run(work: string): Promise<void> {
  const project = join(work, "projeto");
  mkdirSync(project, { recursive: true });
  git(project, "init", "-q", "-b", "main");

  const settingsFile = join(testHome(), ".claude", "settings.json");
  const original = { model: "opus" };
  mkdirSync(join(testHome(), ".claude"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(original, null, 2));

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  const dataDir = join(work, "data");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-otel",
      port: 0,
      token,
      dataDir,
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0, token: crypto.randomUUID().replaceAll("-", "") },
      telemetry: { port: 0 },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const prompt = { "session.id": SESSION, "prompt.id": "prompt-1" };
  const fake = installFakeClaude([
    { do: "session-start", sessionId: SESSION },
    {
      do: "otlp",
      events: [
        { name: "user_prompt", afterMs: 0, attrs: { ...prompt, prompt_length: 9 } },
        {
          name: "api_request",
          afterMs: 1_000,
          attrs: {
            ...prompt,
            request_id: "r1",
            cost_usd: 0.01,
            duration_ms: 900,
            input_tokens: 12,
          },
        },
        {
          name: "tool_decision",
          afterMs: 6_000,
          attrs: {
            ...prompt,
            tool_use_id: "t1",
            tool_name: "Bash",
            decision: "accept",
            source: "user_temporary",
          },
        },
        {
          name: "tool_result",
          afterMs: 6_500,
          attrs: {
            ...prompt,
            tool_use_id: "t1",
            tool_name: "Bash",
            duration_ms: 400,
            success: "true",
          },
        },
        {
          name: "api_request",
          afterMs: 7_000,
          attrs: { ...prompt, request_id: "r2", cost_usd: 0.02, duration_ms: 500 },
        },
        {
          name: "api_error",
          afterMs: 8_000,
          attrs: { ...prompt, request_id: "r3", status_code: 529 },
        },
        // Content an exporter might send anyway: it must not be kept.
        {
          name: "user_prompt",
          afterMs: 9_000,
          attrs: { ...prompt, prompt: "a secret prompt", prompt_length: 15 },
        },
      ],
    },
    { do: "exit", code: 0 },
  ]);
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);
    const info = await client.call<{ features: string[] }>("host.info", {});
    if (!info.features.includes("telemetry")) throw new Error("o host não anuncia telemetry");

    step = "esperar o receptor publicado";
    const published = join(dataDir, "telemetry.json");
    const receiver = await until(
      () =>
        existsSync(published) ? (JSON.parse(readFileSync(published, "utf8")).url as string) : null,
      "telemetry.json do daemon",
    );
    log(`receptor OTLP em ${receiver}`);

    step = "recusar um token errado";
    const refused = await fetch(`${receiver}/v1/logs`, {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: "{}",
    });
    if (refused.status !== 401) throw new Error(`token errado: ${refused.status}`);
    log("token errado: 401");

    step = "abrir flightdeckd claude";
    const wrapper = Bun.spawn([process.execPath, "run", BIN, "claude", "crie a.txt"], {
      cwd: project,
      env: { ...process.env, FLIGHTDECK_CONFIG: configPath },
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await withTimeout(wrapper.exited, "flightdeckd claude terminar");
    if (code !== 0) throw new Error(`flightdeckd claude saiu com ${code}`);

    step = "conferir o que o claude recebeu";
    const start = events(fake.events(), "start")[0] as unknown as { env: Record<string, string> };
    const exporter = Object.keys(start.env).filter(
      (k) => k.startsWith("OTEL_") || k === "CLAUDE_CODE_ENABLE_TELEMETRY",
    );
    if (exporter.some((k) => k.startsWith("OTEL_LOG_"))) {
      throw new Error(
        `variável de conteúdo ligada: ${exporter.filter((k) => k.startsWith("OTEL_LOG_"))}`,
      );
    }
    if (start.env.CLAUDE_CODE_ENABLE_TELEMETRY !== "1" || !start.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      throw new Error(`variáveis do exportador: ${exporter}`);
    }
    const sent = events(fake.events(), "otlp")[0];
    if (sent?.status !== 200) throw new Error(`o exportador recebeu ${sent?.status}`);
    log(`${exporter.length} variáveis do exportador, sem nenhuma de conteúdo; o OTLP voltou 200`);

    step = "conferir a linha do tempo";
    const { prompts } = await client.call<{ prompts: Prompt[] }>("telemetry.session", {
      claudeSessionId: SESSION,
    });
    const first = prompts.find((p) => p.promptId === "prompt-1");
    if (!first) throw new Error(`prompts: ${JSON.stringify(prompts)}`);
    const kinds = first.items.map((i) => i.kind).join(",");
    if (kinds !== "api,permission,tool,api,error") throw new Error(`passos: ${kinds}`);
    if (Math.abs(first.costUsd - 0.03) > 1e-9) throw new Error(`custo ${first.costUsd}`);
    const wait = first.items.find((i) => i.kind === "permission")?.waitMs;
    if (wait !== 5_000) throw new Error(`espera de permissão ${wait}`);
    if (first.waitMs !== 5_000) throw new Error(`espera do prompt ${first.waitMs}`);
    log("1 prompt: 5 passos, custo US$ 0,03, espera de permissão de 5 s");

    step = "o conteúdo não ficou";
    const db = new Database(join(dataDir, "flightdeck.db"), { readonly: true });
    const dump = JSON.stringify(db.query("SELECT * FROM telemetry_events").all());
    db.close();
    if (dump.includes("a secret prompt")) throw new Error("o texto do prompt foi guardado");
    log("o texto do prompt não foi guardado");

    step = "settings.json intocado";
    const after = JSON.parse(readFileSync(settingsFile, "utf8"));
    if (JSON.stringify(after) !== JSON.stringify(original)) {
      throw new Error(`settings.json mudou: ${JSON.stringify(after)}`);
    }
    log("settings.json igual ao original");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    fake.restore();
  }
}

const work = realTempDir("flightdeck-smoke-otel-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE OTEL OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE OTEL FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
