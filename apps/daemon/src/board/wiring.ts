import type { Database } from "bun:sqlite";
import { type Config, updateConfigFile } from "../config.ts";
import { type CheckLoopDeps, CheckLoopSwitch, cardMode } from "./check-loop.ts";
import { HostPause } from "./host-pause.ts";
import type { BoardOptions } from "./types.ts";

/** What the host's pause of new card runs is built from. */
export interface HostPauseDeps {
  config: Pick<Config, "pauseNewRuns">;
  configFile: string;
  /** What still runs, as the auto update's idle check counts it. */
  running: () => number;
}

/**
 * Issue #1404 (issue #1593): the person's pause of new card runs, kept in the config, and the
 * `host.pause` service that reads and sets it.
 */
export function createHostPause({ config, configFile, running }: HostPauseDeps) {
  const hostPause = new HostPause(config.pauseNewRuns);
  const server = {
    status: () => ({ paused: hostPause.paused(), running: running() }),
    set: async (paused: boolean) => {
      // The file first: when it cannot be written the pause stays as it was, for the client and the daemon.
      await updateConfigFile(configFile, (raw) => ({ ...raw, pauseNewRuns: paused }));
      config.pauseNewRuns = paused;
      hostPause.set(paused);
    },
  };
  return { hostPause, server };
}

/** What the check loop reads (issue #1361): the project's trust and the sessions' modes. */
export interface CheckLoopWiringDeps {
  db: Database;
  trust: { isTrustedFolder(path: string): boolean };
  /** A project's watch settings, read from the database alone. */
  readSettings(db: Database, projectId: string): CheckLoopSettings;
  runner: CheckLoopBoard["runner"];
}

type CheckLoopBoard = NonNullable<BoardOptions["checkLoop"]>;
type CheckLoopSettings = ReturnType<CheckLoopDeps["settings"]>;

/**
 * Issue #1361 (issue #1593): the check loop, on the watch's checks and the project's trust. The
 * board's part runs its checks through the bounded runner; the switch (`card.checkLoop`) is made
 * once the board and the watcher exist.
 */
export function createCheckLoop({ db, trust, readSettings, runner }: CheckLoopWiringDeps) {
  const isTrusted = (path: string) => trust.isTrustedFolder(path);
  const board: CheckLoopBoard = {
    // From the database alone: the board reads them while it starts, before the watcher exists.
    settings: (projectId) => readSettings(db, projectId),
    isTrusted,
    runner,
  };
  const switchOf = (deps: {
    board: CheckLoopDeps["board"];
    watcher: { settings(projectId: string): CheckLoopSettings };
    manager: Parameters<typeof cardMode>[1];
  }) =>
    new CheckLoopSwitch({
      board: deps.board,
      settings: (projectId) => deps.watcher.settings(projectId),
      isTrusted,
      modeOf: (card) => cardMode(card, deps.manager),
    });
  return { board, switchOf };
}
