import type { Database } from "bun:sqlite";
import type { Board } from "../board/index.ts";
import { type BoardSyncDeps, createBoardSync } from "../boardsync/index.ts";
import type { Config } from "../config.ts";
import { Issues } from "../issues/index.ts";
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

/** What the board's work around its cards is built from. */
export interface BoardWorkDeps extends Omit<WatchDeps, "board"> {
  board: Board;
  autoApprove: AutomationsWiringDeps["autoApprove"] & BoardSyncDeps["autoApprove"];
  gh: BoardSyncDeps["gh"];
  config: AutomationsWiringDeps["config"];
  log: (message: string) => void;
}

/**
 * Issue #1593: the work around the board's cards. The issues (phase 13), the boards of GitHub
 * Projects read through the host's gh (phase 38), the watch that fixes the cards' PRs inside their
 * limits (phase 22), and the automations that listen to the board's PR polling for `ci_failed` and
 * run the schedule (phase 13). The watch is built before the automations: a watched PR is the
 * watch's alone (#77). The caller starts and stops each one, in its own boot and shutdown order.
 */
export function createBoardWork({
  board,
  autoApprove,
  gh,
  config,
  log,
  ...watchDeps
}: BoardWorkDeps) {
  const { store } = watchDeps;
  const issues = new Issues({ board, autoApprove });
  const boardSync = createBoardSync({ db: store.db, board, autoApprove, gh });
  const { watcher, fixer, watch } = createWatch({ ...watchDeps, board });
  const automations = new Automations(
    automationsOptions({ db: store.db, board, issues, autoApprove, config, log, fixer }),
  );
  return { issues, boardSync, watcher, fixer, watch, automations };
}
