import type { Database } from "bun:sqlite";
import type { Board } from "../board/index.ts";
import { type BoardSyncDeps, createBoardSync } from "../boardsync/index.ts";
import type { Config } from "../config.ts";
import { Issues } from "../issues/index.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { createWatch, type WatchDeps } from "../watch/index.ts";
import { Automations, type AutomationsOptions } from "./automations.ts";

/** What the automations are built from, beside the watch's fixer. */
export interface AutomationsWiringDeps {
  db: Database;
  board: AutomationsOptions["board"];
  issues: AutomationsOptions["issues"];
  autoApprove: NonNullable<AutomationsOptions["autoApprove"]>;
  config: { automations: Pick<Config["automations"], "issuePollIntervalMs"> };
  log: (message: string) => void;
  /** The watch's fixer: a card whose PR is watched is fixed by the watch alone (issue #77). */
  fixer: NonNullable<AutomationsOptions["prWatch"]>;
}

/** The automations' options as the daemon builds them (issue #1593). */
export function automationsOptions({
  db,
  board,
  issues,
  autoApprove,
  config,
  log,
  fixer,
}: AutomationsWiringDeps): AutomationsOptions {
  return {
    db,
    board,
    issues,
    autoApprove,
    pollMs: config.automations.issuePollIntervalMs,
    log,
    prWatch: fixer,
  };
}

/** The PR watch's `startServer` group. */
type PrWatchGroup = NonNullable<NonNullable<DomainModule<"prWatch">["server"]>["prWatch"]>;

/** What the board's work around its cards is built from. */
export interface BoardWorkDeps extends Omit<WatchDeps, "board"> {
  board: Board;
  autoApprove: AutomationsWiringDeps["autoApprove"] & BoardSyncDeps["autoApprove"];
  gh: BoardSyncDeps["gh"];
  config: AutomationsWiringDeps["config"];
  log: (message: string) => void;
  /** Issue #1361: the check loop's switch, on the watch's checks. */
  checkLoopOf: (
    watcher: ReturnType<typeof createWatch>["watcher"],
  ) => NonNullable<PrWatchGroup["checkLoop"]>;
}

/**
 * Issue #1593: the work around the board's cards. The issues (phase 13), the boards of GitHub
 * Projects read through the host's gh (phase 38), the watch that fixes the cards' PRs inside their
 * limits (phase 22), and the automations that listen to the board's PR polling for `ci_failed` and
 * run the schedule (phase 13). The watch is built before the automations: a watched PR is the
 * watch's alone (#77). Its module (#2094) serves the `boardsync`, `prWatch`, `issues` and
 * `automations` groups; starts the automations and the watch; starts the board sync's loop once the
 * server listens; and stops the automations (waiting for a tick or an issue search in flight), the
 * watch and the board sync's loop. The caller stops the board after it: all of them use the board.
 */
export function createBoardWork({
  board,
  autoApprove,
  gh,
  config,
  log,
  checkLoopOf,
  ...watchDeps
}: BoardWorkDeps) {
  const { store } = watchDeps;
  const issues = new Issues({ board, autoApprove });
  const boardSync = createBoardSync({ db: store.db, board, autoApprove, gh });
  const { watcher, fixer, watch } = createWatch({ ...watchDeps, board });
  const automations = new Automations(
    automationsOptions({ db: store.db, board, issues, autoApprove, config, log, fixer }),
  );
  const module: DomainModule<"boardsync" | "prWatch" | "issues" | "automations"> = {
    server: {
      boardsync: boardSync.service,
      prWatch: serverGroup<"prWatch">()({ watch, checkLoop: checkLoopOf(watcher) }),
      issues,
      automations,
    },
    start: () => {
      automations.start();
      watch.start();
    },
    started: () => boardSync.loop.start(),
    stop: async () => {
      automations.stop();
      await automations.idle();
      watch.stop();
      boardSync.loop.stop();
    },
  };
  return { modules: [module] as const, issues, boardSync, watcher, fixer, watch, automations };
}
