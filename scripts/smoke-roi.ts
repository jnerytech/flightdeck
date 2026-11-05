#!/usr/bin/env bun
/**
 * ROI smoke (phase 36): a `--runtime fake` daemon with a temporary git project. Two cards are
 * finished and the project's default of 2 hours per card is set: `roi.summary` answers the counts
 * and the hours (a card's own estimate replaces the default for that card), the previous period
 * is empty, and a malformed range is refused. The host announces `roi`. No claude, no network.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type RoiSummaryResult } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon inherits PATH and HOME: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);
// The home guard hides ~/.gitconfig: the commits need an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");

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

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
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
    await this.call("hello", { token, client: "smoke-roi" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) {
      throw new Error(
        `${type}: ${result.error.code} ${result.error.reason ?? ""} ${result.error.message}`.trim(),
      );
    }
    return result.data as T;
  }

  /** The error of a call that should fail: `type: code reason`. */
  async fail(type: string, payload: unknown): Promise<string> {
    return this.call(type, payload).then(
      () => "conseguiu",
      (error: Error) => error.message,
    );
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
    const match = /listening on (ws:\/\/\S+)/.exec(buffer);
    if (match?.[1]) return match[1];
  }
  throw new Error(`daemon saiu sem anunciar a porta: ${buffer}`);
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

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "app");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-roi",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      history: { roots: [join(work, "sem-historico")] },
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
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "o host anuncia roi";
    const info = await client.call<{ features: string[] }>("host.info", {});
    if (!info.features.includes("roi")) throw new Error("o host devia anunciar roi");
    log("o host anuncia roi");

    step = "terminar dois cards";
    const project = await client.call<{ id: string; projectKey?: string }>("project.add", {
      path: repo,
    });
    await client.call("project.update", { projectId: project.id, defaultHours: 2 });
    const made: string[] = [];
    for (const title of ["um", "dois"]) {
      const card = await client.call<{ id: string }>("card.create", {
        projectId: project.id,
        title,
        description: "",
      });
      await client.call("card.move", { cardId: card.id, column: "done" });
      made.push(card.id);
    }
    log("dois cards terminados");

    step = "resumo com o padrão do projeto";
    const today = new Date().toISOString().slice(0, 10);
    const from = `${today.slice(0, 8)}01`;
    const summary = async () => client.call<RoiSummaryResult>("roi.summary", { from, to: today });
    const mine = (result: RoiSummaryResult) =>
      result.projects.find((p) => p.name === "app")?.current;
    const first = mine(await summary());
    if (first?.cards !== 2 || first.hours !== 4 || first.cardsWithoutEstimate !== 0) {
      throw new Error(`resumo inesperado: ${JSON.stringify(first)}`);
    }
    log("2 cards, 4 horas estimadas");

    step = "a estimativa do card vale mais que o padrão";
    await client.call("card.update", { cardId: made[0], estimateHours: 5 });
    const second = mine(await summary());
    if (second?.hours !== 7) throw new Error(`devia somar 5 + 2 = 7 horas: ${second?.hours}`);
    log("5 + 2 = 7 horas");

    step = "sem padrão, o card sem horas é contado";
    await client.call("project.update", { projectId: project.id, defaultHours: null });
    const third = mine(await summary());
    if (third?.hours !== 5 || third.cardsWithoutEstimate !== 1) {
      throw new Error(`devia contar 1 card sem estimativa: ${JSON.stringify(third)}`);
    }
    log("1 card sem estimativa contado");

    step = "um intervalo mal formado é recusado";
    const refused = await client.fail("roi.summary", { from: "ontem", to: today });
    if (!refused.includes("bad_request")) throw new Error(`devia recusar: ${refused}`);
    log("intervalo mal formado recusado");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

const work = realTempDir("flightdeck-smoke-roi-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE ROI OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE ROI FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
