#!/usr/bin/env bun
/**
 * Review smoke: a `--runtime fake` daemon and a temporary repository with a local remote, a
 * `.worktreeinclude` and an ignored `.env`. The card's worktree gets the `.env`; the fake edits
 * two files (two `[commit]` turns); an inline comment goes to the card's session in the review's
 * format; a file is reverted and the undo brings it back; "Merge e arquivar" with squash takes
 * the card to Concluído, the base gains one commit and the worktree is gone.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ack, parseServerMessage, type ServerMessage } from "@flightdeck/protocol";
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

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

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
    await new Promise<void>((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
        once: true,
      });
    });
    await this.call("hello", { token, client: "smoke-review" });
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

  /** Whether the session's events (after `session.subscribe`) have a message with `text`. */
  said(sessionId: string, text: string): boolean {
    return this.frames.some(
      (f) =>
        f.type === "event" && f.sessionId === sessionId && JSON.stringify(f.event).includes(text),
    );
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

interface Card {
  id: string;
  column: string;
  sessionId: string | null;
  sessionStatus: string | null;
  worktreePath: string | null;
}

async function run(work: string): Promise<void> {
  const projects = join(work, "projects");
  const repo = join(projects, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  // The daemon's git and this script's read the same line endings (the global autocrlf aside).
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  writeFileSync(join(repo, ".gitignore"), ".env\n");
  writeFileSync(join(repo, ".worktreeinclude"), ".env\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  writeFileSync(join(repo, ".env"), "SEGREDO=1\n");
  // The local remote: nothing ever leaves this machine.
  git(projects, "init", "-q", "--bare", "remote.git");
  git(repo, "remote", "add", "origin", join(projects, "remote.git"));
  git(repo, "push", "-q", "origin", "main");

  const token = crypto.randomUUID().replaceAll("-", "");
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-review",
      port: 0,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [projects],
      runtime: "fake",
      hooks: { port: 0 },
      history: { roots: [join(work, "sem-historico")] },
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

    step = "card com .worktreeinclude";
    const project = await client.call<{ id: string }>("project.add", {
      path: repo,
      promptTemplate: "",
    });
    const created = await client.call<{ id: string }>("card.create", {
      projectId: project.id,
      title: "Revisar mudanças",
      description: "[commit]",
    });
    await client.call("card.start", { cardId: created.id });
    const idle = (expect: (card: Card) => boolean, what: string) =>
      until(async () => {
        const card = await client.call<Card>("card.get", { cardId: created.id });
        return card.sessionStatus === "idle" && expect(card) ? card : null;
      }, what);
    const first = await idle((c) => c.worktreePath !== null, "primeira edição do fake");
    const worktree = first.worktreePath as string;
    if (readFileSync(join(worktree, ".env"), "utf8") !== "SEGREDO=1\n") {
      throw new Error("o .env não chegou à worktree");
    }
    log(".env copiado pelo .worktreeinclude");

    step = "duas edições do fake";
    await client.call("card.message", { cardId: created.id, text: "[commit]" });
    await idle(() => existsSync(join(worktree, "fake-2.txt")), "segunda edição do fake");
    const changes = await client.call<{ files: Array<{ path: string }> }>("changes.get", {
      target: `card:${created.id}`,
    });
    const paths = changes.files.map((f) => f.path).sort();
    if (JSON.stringify(paths) !== JSON.stringify(["fake-1.txt", "fake-2.txt"])) {
      throw new Error(`mudanças do card: ${JSON.stringify(paths)}`);
    }
    log("o fake editou fake-1.txt e fake-2.txt");

    step = "revisão inline";
    const sessionId = first.sessionId as string;
    await client.call("session.subscribe", { sessionId });
    const target = `card:${created.id}`;
    await client.call("review.add", {
      target,
      path: "fake-2.txt",
      side: "new",
      lineStart: 1,
      lineEnd: 1,
      body: "explique esta linha",
    });
    const sent = await client.call<{ via: string; text: string }>("review.send", { target });
    const expected =
      "Revisão das mudanças:\n1. `fake-2.txt` linha 1:\n   > [commit]\n   explique esta linha";
    if (sent.via !== "card" || sent.text !== expected) {
      throw new Error(`revisão enviada: ${JSON.stringify(sent)}`);
    }
    await until(
      async () => client.said(sessionId, JSON.stringify(expected).slice(1, -1)),
      "a revisão chegar à sessão do card",
    );
    // The quote has the fake's `[commit]`: it commits once more on this turn, which must end
    // before the merge.
    await until(
      async () => client.said(sessionId, "Echo: Revisão das mudanças:"),
      "a resposta do agente",
    );
    await idle(() => true, "o agente terminar o turno da revisão");
    log("a revisão chegou à sessão do card no formato certo");

    step = "reverter e desfazer";
    await client.call("changes.revert", { target, path: "fake-1.txt", confirm: true });
    if (existsSync(join(worktree, "fake-1.txt"))) throw new Error("fake-1.txt continuou lá");
    await client.call("changes.undoRevert", { target, path: "fake-1.txt", confirm: true });
    if (!existsSync(join(worktree, "fake-1.txt")))
      throw new Error("o desfazer não trouxe fake-1.txt");
    log("fake-1.txt revertido e recuperado pelo desfazer");

    step = "merge e arquivar";
    const before = Number(git(repo, "rev-list", "--count", "main"));
    const done = await client.call<Card>("card.mergeLocal", {
      cardId: created.id,
      mode: "squash",
      confirm: true,
    });
    const after = Number(git(repo, "rev-list", "--count", "main"));
    if (done.column !== "done" || after !== before + 1 || existsSync(worktree)) {
      throw new Error(
        `merge: coluna ${done.column}, ${before} → ${after} commits, worktree ${existsSync(worktree)}`,
      );
    }
    const left = git(repo, "status", "--porcelain");
    if (left !== "") throw new Error(`a base ficou com mudanças: ${left}`);
    log("squash na main, card em Concluído e a worktree removida");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

const work = realTempDir("flightdeck-smoke-review-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE REVIEW OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE REVIEW FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
