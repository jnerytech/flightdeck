import { join } from "node:path";
import { Board, type BoardOptions } from "../src/board/board.ts";
import { git as runGit } from "../src/board/command.ts";
import type { PrCheck, PrComment, PrProvider } from "../src/board/pr.ts";
import type { PrState } from "../src/board/types.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { Quota } from "../src/quota/quota.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { SessionManager } from "../src/sessions/session-manager.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { PrFixer } from "../src/watch/fix.ts";
import { PrWatcher, type WatchSettings, type WatchTrigger } from "../src/watch/watch.ts";
import { cardWhen, git, gitRepo } from "./board-helpers.ts";
import { manualTime } from "./time-helpers.ts";

/**
 * Shared by the tests of phase 22's watcher (consertar, rastro): a card with an open PR, a
 * worktree whose work is pushed to a local remote, a fake PR host, and the fixer over them.
 * The caller registers the cleanups.
 */
export const cleanups: Array<() => unknown> = [];

export const PR = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/9";

export const failing = (name = "CI", buildId = "88"): PrCheck => ({
  name,
  state: "failing",
  kind: "build",
  buildId,
});

export const comment = (id: string, body: string, author = "Ana"): PrComment => ({
  id,
  path: "src/login.ts",
  line: 3,
  author,
  authorAssociation: null,
  authorIdentity: `${author.toLowerCase()}@acme.com`,
  body,
  resolved: false,
  kind: "inline",
});

export interface FixtureOptions {
  settings?: Partial<WatchSettings>;
  board?: Partial<BoardOptions>;
  /** Exit code of a local check command; 0 for the others. */
  checkExit?: Record<string, number>;
  /** Runs while the local checks run: where the world changes under a round. */
  duringChecks?: () => void;
}

/** A card with a PR open, a worktree with work pushed to a local remote, and the fixer over it. */
export async function fixture(options: FixtureOptions = {}) {
  const { root, repo } = gitRepo();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
    pack: packPersonas,
  });
  const runtime = new FakeRuntime({ delayMs: 1 });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
    personas,
  });
  const time = manualTime();
  const quota = new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers });
  cleanups.push(() => quota.stop());
  const host = {
    state: "open" as PrState,
    log: "ERRO: 3 testes falharam",
    comments: [] as PrComment[],
    logFails: false,
  };
  const provider: PrProvider = {
    create: async () => PR,
    url: async () => null,
    status: async () => ({ state: host.state, checks: null }),
    comments: async () => host.comments,
    health: async () => ({ checks: [], conflicts: false }),
    buildLog: async () => {
      if (host.logFails) throw new Error("sem log");
      return host.log;
    },
  };
  const board = new Board({
    db: store.db,
    manager,
    allowedRoots: [root],
    prProvider: () => provider,
    prPollIntervalMs: 1_000_000,
    quota,
    ...options.board,
  });
  cleanups.push(() => board.stop());
  cleanups.push(() => manager.shutdown());
  const remote = join(root, "remote.git");
  git(root, "init", "-q", "--bare", "remote.git");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  const project = await board.addProject({
    path: repo,
    prProvider: "azure-devops",
    promptTemplate: "",
  });
  const card = board.createCard(project.id, { title: "Login", description: "faça o login" });
  await board.startCard(card.id);
  const started = await cardWhen(board, card.id, (c) => c.column === "review");
  const worktree = started?.worktreePath ?? repo;
  const branch = started?.branch ?? "";
  git(worktree, "config", "commit.gpgsign", "false");
  git(worktree, "commit", "-q", "--allow-empty", "-m", "trabalho do card");
  git(worktree, "push", "-q", "-u", "origin", branch);
  store.db.query("UPDATE cards SET pr_url = ?, pr_state = 'open' WHERE id = ?").run(PR, card.id);

  const watcher = new PrWatcher({ db: store.db, board, provider: () => provider });
  watcher.setSettings(project.id, { enabled: true, ...options.settings });
  const ran: Array<{ command: string; cwd: string }> = [];
  const gitCalls: string[][] = [];
  const fixer = new PrFixer({
    db: store.db,
    board,
    watcher,
    provider: () => provider,
    checks: {
      run: async (command, cwd) => {
        ran.push({ command, cwd });
        options.duringChecks?.();
        return { exitCode: options.checkExit?.[command] ?? 0, output: `saída de ${command}` };
      },
    },
    git: (cwd, ...args) => {
      gitCalls.push(args);
      return runGit(cwd, ...args);
    },
  });
  const trigger = (over: Partial<WatchTrigger> = {}): WatchTrigger => ({
    cardId: card.id,
    failed: [],
    conflicts: false,
    comments: [],
    ...over,
  });
  /** The first user message of a session: the prompt of the round. */
  const promptOf = (sessionId: string | null) =>
    store
      .eventsSince(sessionId ?? "", 0)
      .map((e) => e.event)
      .flatMap((e) => (e.type === "message.user" ? [e.text] : []))[0] ?? "";
  const commitsAhead = () => git(remote, "rev-list", "--count", `main..${branch}`);
  return {
    ...time,
    root,
    repo,
    store,
    runtime,
    manager,
    quota,
    host,
    board,
    project,
    card,
    watcher,
    fixer,
    trigger,
    promptOf,
    commitsAhead,
    ran,
    gitCalls,
    worktree,
    branch,
    remote,
  };
}

/** A comment that makes the fake runtime commit (and spend `cost`), so a round has work to push. */
export const work = (cost = 0, text = "troque o nome") =>
  comment("1/1", `[commit] [cost:${cost}] ${text}`);
