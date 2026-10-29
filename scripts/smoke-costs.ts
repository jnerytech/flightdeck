#!/usr/bin/env bun
/**
 * Costs smoke: a `--runtime fake` daemon whose history root holds fixture transcripts (a
 * terminal session with one message over several lines, a subagent and a model without a
 * price) of the board's project. After the initial load, `costs.summary` matches the cost
 * computed by hand; a project budget with `queue` already over its limit holds a new card with
 * reason `budget`, and raising the limit lets it start. Then the CSV export.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

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
const FIXTURES = join(ROOT, "apps/daemon/test/fixtures/history");
const SESSION = "aaaaaaaa-0000-4000-8000-000000000001";
/**
 * The fixtures priced by hand with the default table (US$ per million tokens):
 * msg_A opus (100 × 4 + 50 × 20 + 1000 × 0.2 + 100 × 4 × 1.25 + 200 × 4 × 2) = 3700,
 * msg_B opus fast ((10 × 4 + 20 × 20) × 2) = 880, msg_C sonnet (5 × 2 + 5 × 10 + 400 × 2 × 1.25)
 * = 1060, the subagent's msg_S1 haiku (2000 × 0.1 + 100 × 0.5) = 250; msg_D has no price.
 */
const EXPECTED_USD = (3700 + 880 + 1060 + 250) / 1_000_000;

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD` in this machine's time zone, as the daemon counts days. */
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function until<T>(check: () => Promise<T | null | undefined | false>, what: string) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(50);
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
    });
    await new Promise<void>((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
        once: true,
      });
    });
    await this.call("hello", { token, client: "smoke-costs" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await Promise.race([
      ack,
      Bun.sleep(TIMEOUT_MS).then(() => {
        throw new Error(`timeout: ack de ${type}`);
      }),
    ]);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
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

/** A fixture with the repo as its cwd and every message written now (today, for the budget). */
function fixture(name: string, cwd: string): string {
  const now = new Date().toISOString();
  return readFileSync(join(FIXTURES, name), "utf8")
    .replaceAll("__CWD__", JSON.stringify(cwd).slice(1, -1))
    .replace(/"timestamp":"[^"]+"/g, `"timestamp":"${now}"`);
}

interface Summary {
  totals: { costUsd: number; messages: number; unpricedMessages: number };
  byProject: Array<{ projectKey: string }>;
}

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  // The transcripts of a terminal session in the repo, and of one of its subagents.
  const history = join(work, "claude-projects");
  const dir = join(history, "-repo");
  mkdirSync(join(dir, SESSION, "subagents"), { recursive: true });
  writeFileSync(join(dir, `${SESSION}.jsonl`), fixture("usage-main.jsonl", repo));
  writeFileSync(
    join(dir, SESSION, "subagents", "agent-1.jsonl"),
    fixture("usage-subagent.jsonl", repo),
  );

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-costs",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      hooks: { port: 0 },
      history: { roots: [history] },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "carga inicial";
    await until(async () => {
      const status = await client.call<{ initialLoad: { state: string } }>("costs.status", {});
      return status.initialLoad.state === "done";
    }, "carga inicial");
    log("carga inicial concluída");

    step = "costs.summary";
    const today = localDay(Date.now());
    const range = { from: localDay(Date.now() - 86_400_000), to: today };
    const summary = await client.call<Summary>("costs.summary", range);
    const { costUsd, messages, unpricedMessages } = summary.totals;
    if (Math.abs(costUsd - EXPECTED_USD) > 1e-9 || messages !== 5 || unpricedMessages !== 1) {
      throw new Error(
        `esperava US$ ${EXPECTED_USD} em 5 mensagens: ${JSON.stringify(summary.totals)}`,
      );
    }
    const projectKey = summary.byProject[0]?.projectKey ?? "";
    log(`US$ ${costUsd.toFixed(6)} em ${messages} mensagens, como o cálculo à mão (${projectKey})`);

    step = "orçamento segura o card";
    const budget = await client.call<{ id: string }>("budget.set", {
      scope: "project",
      projectKey,
      period: "day",
      limitUsd: 0.001,
      action: "queue",
    });
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      promptTemplate: "",
    });
    const card = await client.call<{ id: string }>("card.create", {
      projectId: project.id,
      title: "Segura",
      description: "oi",
    });
    const queued = await client.call<{ queued: boolean; queueReason: string | null }>(
      "card.start",
      { cardId: card.id },
    );
    if (!queued.queued || queued.queueReason !== "budget") {
      throw new Error(`o card devia esperar pelo orçamento: ${JSON.stringify(queued)}`);
    }
    log("card novo na fila com motivo budget");

    step = "limite maior solta o card";
    await client.call("budget.set", {
      id: budget.id,
      scope: "project",
      projectKey,
      period: "day",
      limitUsd: 100,
      action: "queue",
    });
    await until(async () => {
      const got = await client.call<{ sessionId: string | null }>("card.get", { cardId: card.id });
      return got.sessionId !== null;
    }, "card sair da fila");
    log("com o limite maior, o card saiu da fila");

    step = "costs.export";
    const file = await client.call<{ csv: string; filename: string }>("costs.export", range);
    const lines = file.csv.trimEnd().split("\n");
    if (!lines[0]?.startsWith("day,project_key,model,origin") || lines.length < 4) {
      throw new Error(`CSV inesperado: ${file.csv}`);
    }
    log(`${file.filename}: ${lines.length - 1} linhas`);
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

// The real path: on the GitHub runner TEMP is an 8.3 name that the daemon resolves.
const work = realTempDir("flightdeck-smoke-costs-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE COSTS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE COSTS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
