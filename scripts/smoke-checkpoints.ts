#!/usr/bin/env bun
/**
 * Checkpoints smoke: a `--runtime fake` daemon with a temporary HOME and a temporary repository.
 * A session opened by `flightdeckd claude` with the fake claude makes two turns that edit and
 * create files; the hooks give a snapshot before and after each turn, and the user's `git status`
 * and index never change because of them. `rewind.apply` back to before the second turn restores
 * the files and removes the one it created, `rewind.undo` brings them back, `session.fork` gives
 * a new id and `mcp.test` of a local stdio server lists its tools.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import { installFakeClaude } from "../apps/daemon/test/fake-claude.ts";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { assertNoNetwork, installNetworkGuard } from "./test/network-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon, the wrapper and the fake claude inherit PATH and HOME: none of the real claude,
// gh, az or ~/.claude is reachable.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const network = installNetworkGuard();
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);
// The home guard hides ~/.gitconfig: the repository's first commit needs an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 20_000;
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const ECO = join(ROOT, "apps/daemon/test/fixtures/mcp/eco-server.ts");
const SESSION = "cccccccc-0000-4000-8000-000000000012";

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
    await withTimeout(
      new Promise<void>((ok, fail) => {
        this.ws.addEventListener("open", () => ok(), { once: true });
        this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
          once: true,
        });
      }),
      "conectar",
    );
    await this.call("hello", { token, client: "smoke-checkpoints" });
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

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  return proc.stdout.toString();
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

interface Snapshot {
  n: number;
  kind: string;
  prompt: string | null;
}

const sha = (path: string) =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
const text = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

async function run(work: string): Promise<void> {
  const project = join(work, "projeto");
  mkdirSync(project, { recursive: true });
  git(project, "init", "-q", "-b", "main");
  writeFileSync(join(project, ".gitignore"), "ignorado.log\n");
  writeFileSync(join(project, "a.txt"), "v1\n");
  git(project, "add", ".");
  git(project, "commit", "-q", "-m", "base");
  // The user's own pending work: staged, unstaged and ignored, which no snapshot may touch.
  writeFileSync(join(project, "a.txt"), "v1 com mudança do usuário\n");
  writeFileSync(join(project, "ignorado.log"), "log\n");
  writeFileSync(
    join(project, ".mcp.json"),
    JSON.stringify({ mcpServers: { eco: { command: process.execPath, args: [ECO] } } }),
  );

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-checkpoints",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0 },
    }),
  );
  const go = (turn: number) => join(work, `turno-${turn}.ok`);

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  // Each turn waits for the smoke to see its `before` snapshot: the hook only enqueues it.
  const fake = installFakeClaude([
    { do: "session-start", sessionId: SESSION },
    { do: "hook", event: "UserPromptSubmit", payload: { prompt: "primeiro" } },
    { do: "wait-file", path: go(1), timeoutMs: TIMEOUT_MS },
    { do: "write", path: "a.txt", text: "v2\n" },
    { do: "hook", event: "Stop" },
    { do: "hook", event: "UserPromptSubmit", payload: { prompt: "segundo" } },
    { do: "wait-file", path: go(2), timeoutMs: TIMEOUT_MS },
    { do: "write", path: "a.txt", text: "v3\n" },
    { do: "write", path: "b.txt", text: "criado no segundo turno\n" },
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

    step = "instalar hooks";
    const installed = await client.call<{ status: string }>("hooks.install", { confirm: true });
    if (installed.status !== "installed") throw new Error(`hooks: ${installed.status}`);

    const snapshots = async () =>
      (await client.call<{ snapshots: Snapshot[] }>("snapshots.list", { claudeSessionId: SESSION }))
        .snapshots;
    const waitSnapshots = async (count: number, what: string) => {
      const deadline = Date.now() + TIMEOUT_MS;
      for (;;) {
        const list = await snapshots();
        if (list.length >= count) return list;
        if (Date.now() > deadline) throw new Error(`timeout: ${what} (${list.length} snapshots)`);
        await Bun.sleep(50);
      }
    };
    const statusBefore = git(project, "status", "--porcelain=v1", "--ignored");
    const indexBefore = sha(join(project, ".git", "index"));

    step = "primeiro turno";
    wrapper = Bun.spawn([process.execPath, "run", BIN, "claude", "primeiro"], {
      cwd: project,
      env: { ...process.env, FLIGHTDECK_CONFIG: configPath },
      stdout: "inherit",
      stderr: "inherit",
    });
    await waitSnapshots(1, "snapshot antes do primeiro turno");
    if (git(project, "status", "--porcelain=v1", "--ignored") !== statusBefore) {
      throw new Error("o git status do usuário mudou com o snapshot");
    }
    if (sha(join(project, ".git", "index")) !== indexBefore) {
      throw new Error("o índice do usuário mudou com o snapshot");
    }
    log("snapshot antes do primeiro turno; git status e índice do usuário iguais");
    writeFileSync(go(1), "");

    step = "segundo turno";
    await waitSnapshots(3, "snapshot antes do segundo turno");
    writeFileSync(go(2), "");
    const code = await withTimeout(wrapper.exited, "flightdeckd claude terminar");
    if (code !== 0) throw new Error(`flightdeckd claude saiu com ${code}`);
    const all = await waitSnapshots(4, "snapshot depois do segundo turno");
    log(
      `snapshots: ${all.map((s) => `${s.n} ${s.kind}${s.prompt ? ` (${s.prompt})` : ""}`).join(", ")}`,
    );
    if (text(join(project, "a.txt")) !== "v3\n" || !existsSync(join(project, "b.txt"))) {
      throw new Error("os turnos não deixaram a.txt e b.txt");
    }
    if (sha(join(project, ".git", "index")) !== indexBefore) {
      throw new Error("o índice do usuário mudou com os snapshots");
    }

    step = "rewind até antes do segundo turno";
    const second = all.find((s) => s.kind === "before" && s.prompt === "segundo");
    if (!second) throw new Error("sem snapshot antes do segundo turno");
    const preview = await client.call<{ via: string; files: Array<{ path: string }> }>(
      "rewind.preview",
      { claudeSessionId: SESSION, turn: second.n },
    );
    log(`prévia pelo ${preview.via}: ${preview.files.map((f) => f.path).join(", ")}`);
    await client.call("rewind.apply", { claudeSessionId: SESSION, turn: second.n, confirm: true });
    if (text(join(project, "a.txt")) !== "v2\n") {
      throw new Error(`a.txt depois do rewind: ${text(join(project, "a.txt"))}`);
    }
    if (existsSync(join(project, "b.txt"))) throw new Error("b.txt ficou depois do rewind");
    if (text(join(project, "ignorado.log")) !== "log\n")
      throw new Error("o rewind mexeu no ignorado");
    log("a.txt voltou para v2 e b.txt, criado no segundo turno, saiu");

    step = "desfazer o rewind";
    await client.call("rewind.undo", { claudeSessionId: SESSION, confirm: true });
    if (text(join(project, "a.txt")) !== "v3\n" || !existsSync(join(project, "b.txt"))) {
      throw new Error("o desfazer não trouxe a.txt v3 e b.txt");
    }
    log("desfeito: a.txt v3 e b.txt de volta");

    step = "bifurcar";
    const fork = await client.call<{ claudeSessionId: string }>("session.fork", {
      claudeSessionId: SESSION,
      cwd: project,
      open: "terminal",
    });
    if (!fork.claudeSessionId || fork.claudeSessionId === SESSION) {
      throw new Error(`bifurcação sem id novo: ${fork.claudeSessionId}`);
    }
    log(`bifurcada em ${fork.claudeSessionId}`);

    step = "testar servidor MCP";
    const added = await client.call<{ id: string }>("project.add", { path: project });
    const listed = await client.call<{ servers: Array<{ name: string }> }>("mcp.list", {
      projectId: added.id,
    });
    if (listed.servers.map((s) => s.name).join() !== "eco") {
      throw new Error(`mcp.list: ${JSON.stringify(listed.servers)}`);
    }
    const tested = await client.call<{ tools?: string[] }>("mcp.test", {
      projectId: added.id,
      name: "eco",
      confirm: true,
    });
    if (tested.tools?.join() !== "eco") throw new Error(`mcp.test: ${JSON.stringify(tested)}`);
    log("mcp.test do servidor stdio local listou a ferramenta eco");

    step = "remover hooks";
    await client.call("hooks.uninstall", { confirm: true });
    client.close();
  } finally {
    wrapper?.kill();
    daemon.kill();
    await daemon.exited;
    fake.restore();
  }
}

const work = realTempDir("flightdeck-smoke-checkpoints-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoNetwork(network);
  assertNoRefusedChecks(checks);
  console.log("SMOKE CHECKPOINTS OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE CHECKPOINTS FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
