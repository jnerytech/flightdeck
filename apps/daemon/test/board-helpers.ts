import { cpSync, mkdirSync, writeFileSync } from "node:fs";
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

/**
 * What a git call that did not succeed reports: the exit code, or the signal that ended it, and
 * what git wrote. A call the test's own time limit killed has no exit code and no output; saying
 * so keeps it from reading as a git failure (`git add .: ` with nothing after it, on Windows CI).
 */
export function gitFailure(
  args: string[],
  result: {
    exitCode: number | null;
    signalCode?: string | number | null;
    stdout: string;
    stderr: string;
  },
): string {
  const command = `git ${args.join(" ")}`;
  const ended =
    result.exitCode === null
      ? `${command} was killed by ${result.signalCode ?? "a signal"} before it finished (a test that runs out of its time limit kills the child it waits on)`
      : `${command} exited with code ${result.exitCode}`;
  // `git commit` with nothing to commit says so on stdout only.
  const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  return `${ended}: ${output || "(no output)"}`;
}

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
    throw new Error(
      gitFailure(args, {
        exitCode: proc.exitCode,
        signalCode: proc.signalCode ?? null,
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
      }),
    );
  }
  return proc.stdout.toString().trim();
}

let seed: string | undefined;

/**
 * The repository every `gitRepo` copies, built with git once per process. Five git processes per
 * repository were most of the time of the board tests on Windows, where a process start is slow and,
 * when the runner itself slows down, slower still: tests that only needed a repository timed out.
 */
function seedRepo(): string {
  if (seed) return seed;
  const repo = join(tempDir("fd-board-seed-"), "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  seed = repo;
  return repo;
}

/** Allowed root with a git repository (`main`, one commit with README and .gitignore). */
export function gitRepo(name = "repo") {
  const root = tempDir("fd-board-");
  const repo = join(root, name);
  // Timestamps kept, so the index still matches the files it describes.
  cpSync(seedRepo(), repo, { recursive: true, preserveTimestamps: true });
  return { root, repo };
}

let seedWithOrigin: { repo: string; remote: string } | undefined;

/** The seed copied into a repository whose origin is a bare `remote.git` with main pushed. */
function seedOrigin(): { repo: string; remote: string } {
  if (seedWithOrigin) return seedWithOrigin;
  const root = tempDir("fd-board-seed-");
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  cpSync(seedRepo(), repo, { recursive: true, preserveTimestamps: true });
  git(root, "init", "-q", "--bare", "-b", "main", "remote.git");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  seedWithOrigin = { repo, remote };
  return seedWithOrigin;
}

/**
 * Allowed root with a repository whose `origin` is a bare `remote.git` next to it, main pushed (and
 * `origin/main` known): copies of a seed pair, then one git call to point origin at this copy.
 */
export function gitRepoWithOrigin(name = "repo") {
  const seeds = seedOrigin();
  const root = tempDir("fd-board-");
  const repo = join(root, name);
  const remote = join(root, "remote.git");
  cpSync(seeds.repo, repo, { recursive: true, preserveTimestamps: true });
  cpSync(seeds.remote, remote, { recursive: true, preserveTimestamps: true });
  git(repo, "remote", "set-url", "origin", remote);
  return { root, repo, remote };
}

/** Board over an in-memory store, a FakeRuntime and a fresh repo inside the allowed root. */
/** `delayMs` slows the FakeRuntime down, for tests that act while a turn is running. */
export function newBoard(overrides: Partial<BoardOptions> = {}, delayMs = 1) {
  return boardOver(gitRepo(), overrides, delayMs);
}

/** `newBoard` whose repository already has its origin (`remote`), as `gitRepoWithOrigin` makes it. */
export function newBoardWithOrigin(overrides: Partial<BoardOptions> = {}, delayMs = 1) {
  const { remote, ...where } = gitRepoWithOrigin();
  return { ...boardOver(where, overrides, delayMs), remote };
}

function boardOver(
  { root, repo }: { root: string; repo: string },
  overrides: Partial<BoardOptions>,
  delayMs: number,
) {
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
