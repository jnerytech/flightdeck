import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Board, type BoardOptions } from "../src/board/board.ts";
import type { Card } from "../src/board/types.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";
import { whichOnPath } from "../src/which.ts";
import { poll, tempDir } from "./helpers.ts";

// The home guard hides ~/.gitconfig: commits in the temp repos need an identity of their own.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "Flightdeck Teste",
  GIT_AUTHOR_EMAIL: "teste@flightdeck.invalid",
  GIT_COMMITTER_NAME: "Flightdeck Teste",
  GIT_COMMITTER_EMAIL: "teste@flightdeck.invalid",
});

/** Runs git synchronously, failing the test on a non-zero exit. */
export function git(cwd: string, ...args: string[]): string {
  const bin = whichOnPath("git") ?? "git";
  // `env` explicitly: without it Bun passes the environment the process started with (real HOME).
  const proc = Bun.spawnSync([bin, "-c", "core.autocrlf=false", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

/** Allowed root with a git repository (`main`, one commit with README and .gitignore). */
export function gitRepo(name = "repo") {
  const root = tempDir("fd-board-");
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  return { root, repo };
}

/** Board over an in-memory store, a FakeRuntime and a fresh repo inside the allowed root. */
/** `delayMs` slows the FakeRuntime down, for tests that act while a turn is running. */
export function newBoard(overrides: Partial<BoardOptions> = {}, delayMs = 1) {
  const { root, repo } = gitRepo();
  const store = new EventStore(":memory:");
  const runtime = new FakeRuntime({ delayMs });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
  });
  const board = new Board({ db: store.db, manager, allowedRoots: [root], ...overrides });
  return { board, manager, store, runtime, root, repo };
}

/** Polls the card until `check` holds; `null` on timeout, so the `expect` after it fails. */
export function cardWhen(
  board: Board,
  cardId: string,
  check: (card: Card) => boolean,
  timeoutMs = 3000,
): Promise<Card | null> {
  return poll(() => {
    const card = board.getCard(cardId);
    return check(card) ? card : null;
  }, timeoutMs);
}

/**
 * Waits for the board to change into something `check` accepts: it looks now and again on every
 * change the board announces, with no polling. Rejects after `timeoutMs` so a run that never gets
 * there fails with that, not by hanging until the test's own limit.
 */
export function whenChanged<T>(
  board: Board,
  check: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs = 25_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let busy = false;
    let again = false;
    let done = false;
    const finish = () => {
      done = true;
      off();
      clearTimeout(timer);
    };
    const run = async (): Promise<void> => {
      if (done) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const found = await check();
        if (found) {
          finish();
          resolve(found as T);
        }
      } catch (error) {
        finish();
        reject(error);
      }
      busy = false;
      if (again && !done) {
        again = false;
        void run();
      }
    };
    const off = board.watch(() => void run());
    const timer = setTimeout(() => {
      finish();
      reject(new Error("timeout esperando o board mudar"));
    }, timeoutMs);
    void run();
  });
}
