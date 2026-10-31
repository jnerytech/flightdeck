#!/usr/bin/env bun
/**
 * Run environment smoke (phase 24): a `--runtime fake` daemon over a real git repository whose
 * committed `.flightdeck/run.yaml` runs an echo server on `{{port.web}}`. Two cards run at the
 * same time on different ports from different blocks, both answer over HTTP, and Stop ends the
 * servers and the child each one started. The processes are the fixed script of this file, with
 * no shell, in real PTYs. Nothing here reaches the real `claude`, `gh`, `az` or `~/.claude`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type RunState } from "@flightdeck/protocol";
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

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

async function untilAsync<T>(
  check: () => Promise<T | null | undefined | false>,
  what: string,
): Promise<T> {
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
    await this.call("hello", { token, client: "smoke-run" });
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

/** What each card runs: an echo server on the port it is given, and a child that outlives its signals. */
const SERVER = `
const { spawn } = require("node:child_process");
const child = spawn(
  process.execPath,
  ["-e", "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
  { stdio: "ignore" },
);
await Bun.write("pids.json", JSON.stringify({ pid: process.pid, child: child.pid }));
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.argv[2]),
  fetch: (request) => new Response("echo:" + new URL(request.url).pathname),
});
`;

const git = (cwd: string, ...args: string[]) => {
  const proc = Bun.spawnSync(["git", "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Flightdeck Smoke",
      GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
      GIT_COMMITTER_NAME: "Flightdeck Smoke",
      GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function answers(url: string): Promise<string | null> {
  try {
    return await (await fetch(url, { signal: AbortSignal.timeout(1000) })).text();
  } catch {
    return null;
  }
}

async function run(work: string): Promise<void> {
  const token = crypto.randomUUID().replaceAll("-", "");
  const repo = join(work, "app");
  mkdirSync(join(repo, ".flightdeck"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "# app\n");
  writeFileSync(join(repo, "echo-server.ts"), SERVER);
  // The command is the absolute bun of this run: the daemon starts it without any shell.
  writeFileSync(
    join(repo, ".flightdeck", "run.yaml"),
    `run:
  - name: web
    cmd: [${JSON.stringify(process.execPath)}, "echo-server.ts", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
ports: [web]
`,
  );
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "app");

  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-run",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0 },
      terminal: { enabled: true },
      // A block that is not a fixed place: the daemon probes it and takes the next free one.
      run: { portBase: 30_000 + Math.floor(Math.random() * 20_000) },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  const pids: number[] = [];
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "cadastrar o projeto e confiar no run.yaml";
    const project = await client.call<{ id: string }>("project.add", { path: repo });
    const info = await client.call<{ hash: string; trusted: boolean }>("runenv.config", {
      projectId: project.id,
    });
    if (info.trusted) throw new Error("o run.yaml não devia vir confiado");
    await client.call("runenv.trust", { projectId: project.id, hash: info.hash });
    log("o run.yaml foi revisado pelo hash e confiado");

    step = "dois cards com worktree";
    const cards: Array<{ id: string; worktree: string }> = [];
    for (const title of ["um", "dois"]) {
      const card = await client.call<{ id: string }>("card.create", {
        projectId: project.id,
        title,
        description: "faça",
      });
      await client.call("card.start", { cardId: card.id });
      cards.push({ id: card.id, worktree: "" });
    }
    for (const card of cards) {
      card.worktree = await untilAsync(async () => {
        const got = await client.call<{ worktreePath: string | null }>("card.get", {
          cardId: card.id,
        });
        return got.worktreePath;
      }, "a worktree do card");
    }
    log("os dois cards têm worktree");

    step = "Run dos dois cards";
    const states: RunState[] = [];
    for (const card of cards) {
      states.push(await client.call<RunState>("runenv.start", { cardId: card.id }));
    }
    const ports = states.map((s) => s.ports.web);
    if (!ports[0] || !ports[1] || ports[0] === ports[1]) {
      throw new Error(`os cards precisam de portas diferentes: ${JSON.stringify(ports)}`);
    }
    if (Math.floor((ports[0] ?? 0) / 10) === Math.floor((ports[1] ?? 0) / 10)) {
      throw new Error(`os cards precisam de blocos diferentes: ${JSON.stringify(ports)}`);
    }
    log(`portas ${ports[0]} e ${ports[1]}`);

    step = "os dois respondem ao mesmo tempo";
    for (const [i, card] of cards.entries()) {
      await untilAsync(
        async () => {
          const state = await client.call<RunState>("runenv.get", { cardId: card.id });
          return state.processes[0]?.ready === "ready" || null;
        },
        `o preview do card ${i + 1} ficar pronto`,
      );
      const body = await untilAsync(
        () => answers(`http://127.0.0.1:${ports[i]}/ola`),
        "a resposta",
      );
      if (body !== "echo:/ola") throw new Error(`resposta inesperada do card ${i + 1}: ${body}`);
    }
    log("os dois servidores respondem, cada um na sua porta");
    for (const card of cards) {
      const file = join(card.worktree, "pids.json");
      await untilAsync(async () => (existsSync(file) ? true : null), "o pids.json do card");
      const found = JSON.parse(readFileSync(file, "utf8")) as { pid: number; child: number };
      pids.push(found.pid, found.child);
    }

    step = "Stop encerra tudo";
    for (const card of cards) await client.call("runenv.stop", { cardId: card.id });
    await untilAsync(
      async () => (pids.every((pid) => !alive(pid)) ? true : null),
      "os processos e os filhos encerrarem",
    );
    for (const port of ports) {
      const body = await answers(`http://127.0.0.1:${port}/`);
      if (body !== null) throw new Error(`a porta ${port} ainda responde: ${body}`);
    }
    log("os servidores, os filhos e as portas: nada sobrou");
    client.close();
  } finally {
    // Never leave the fixed processes behind, even when a step failed.
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    daemon.kill();
    await daemon.exited;
  }
}

// The real path: on the GitHub runner TEMP is an 8.3 name that the daemon resolves.
const work = realTempDir("flightdeck-smoke-run-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE RUN OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE RUN FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
