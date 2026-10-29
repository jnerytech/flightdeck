#!/usr/bin/env bun
/**
 * Board smoke: a temp repository with a local remote (`git init --bare`), a `--runtime fake`
 * daemon, a `github` project answered by a fake `gh`, a card whose FakeRuntime creates a file and
 * commits it, Em revisão, its diff, the PR, a merge simulated in the fake `gh` and Concluído with
 * the worktree removed.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { installFakeCli } from "./test/fake-cli.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon inherits PATH and HOME: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
// The daemon of this smoke runs no workflow: any check reaching its shell is refused.
const checks = installCheckGuard();
assertCheckGuardActive(checks);
assertCliGuardActive(clis);
// The home guard hides ~/.gitconfig: the FakeRuntime's commits need an identity.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Smoke",
  GIT_AUTHOR_EMAIL: "smoke@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Smoke",
  GIT_COMMITTER_EMAIL: "smoke@flightdeck.invalid",
});

const TIMEOUT_MS = 15_000;
const ROOT = resolve(import.meta.dir, "..");
const PR_URL = "https://github.com/acme/repo/pull/42";

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

interface Card {
  id: string;
  column: string;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  prState: string | null;
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
    await this.call("hello", { token, client: "smoke-board" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await withTimeout(ack, `ack de ${type}`);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  /** Latest `card.updated` of the card that satisfies `check`. */
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

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const remote = join(work, "remote.git");
  git(work, "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  // Push only to local remotes: check where origin points before anything is pushed.
  const origin = git(repo, "remote", "get-url", "origin");
  if (origin !== remote || !existsSync(join(origin, "HEAD"))) {
    throw new Error(`origin não é o remoto local: ${origin}`);
  }
  git(repo, "push", "-q", "origin", "main");
  log(`repositório com remoto local ${remote}`);

  // Fake gh, first on the PATH the daemon inherits: no PR yet, create answers a URL, open.
  const gh = installFakeCli("gh", [
    { args: ["view", "url"], code: 1 },
    { args: ["pr", "create"], stdout: `${PR_URL}\n` },
    { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
  ]);

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-board",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      board: { prPollIntervalMs: 200 },
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
    // `env` explicitly: without it the daemon would get the environment from before the guards.
    { env: process.env, stdout: "pipe", stderr: "inherit" },
  );
  try {
    const url = await withTimeout(readListenUrl(daemon.stdout), "daemon anunciar a porta");
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "cadastrar projeto";
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      prProvider: "github",
    });
    await client.call("board.watch", {});
    log(`projeto ${project.id} com provedor github`);

    step = "criar e iniciar o card";
    const created = await client.call<Card>("card.create", {
      projectId: project.id,
      title: "Arquivo do smoke",
      description: "Crie um arquivo e faça commit [commit]",
    });
    await client.call("card.start", { cardId: created.id });

    step = "esperar Em revisão";
    const reviewed = await until(
      () => client.card(created.id, (c) => c.column === "review"),
      "card em Em revisão",
    );
    log(`card em Em revisão na branch ${reviewed.branch}`);

    step = "conferir o diff";
    const diff = await client.call<{ files: Array<{ path: string; uncommitted: boolean }> }>(
      "card.diff",
      { cardId: created.id },
    );
    const summary = diff.files.map((f) => `${f.path}${f.uncommitted ? "*" : ""}`).join(", ");
    if (summary !== "fake-1.txt") throw new Error(`diff inesperado: ${summary}`);
    log(`diff: ${summary}`);

    step = "abrir o PR";
    const opened = await client.call<Card>("card.pr.create", { cardId: created.id });
    if (opened.prUrl !== PR_URL) throw new Error(`PR com URL ${opened.prUrl}`);
    const create = gh.calls().find((args) => args.includes("create")) ?? [];
    if (!create.includes(reviewed.branch ?? "?") || !create.includes("Arquivo do smoke")) {
      throw new Error(`gh pr create recebeu ${JSON.stringify(create)}`);
    }
    if (!git(remote, "branch", "--list", "fd/*").includes(reviewed.branch ?? "?")) {
      throw new Error("a branch não chegou ao remoto local");
    }
    log(`PR ${opened.prUrl}`);

    step = "simular o merge";
    gh.respond([
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "MERGED" }) },
    ]);
    const done = await until(
      () => client.card(created.id, (c) => c.column === "done" && c.worktreePath === null),
      "card em Concluído com a worktree removida",
    );
    if (existsSync(reviewed.worktreePath ?? "")) throw new Error("a worktree continua no disco");
    log(`Concluído (${done.prState}); worktree removida`);
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
    gh.restore();
  }
}

const work = realTempDir("flightdeck-smoke-board-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE BOARD OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE BOARD FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
