import type { Database } from "bun:sqlite";
import { SecretScanner } from "@flightdeck/protocol";
import { type Config, updateConfigFile } from "../config.ts";
import { present } from "../present.ts";
import type { DomainModule } from "../server/index.ts";
import { Board } from "./board.ts";
import { type CheckLoopDeps, CheckLoopSwitch, cardMode } from "./check-loop.ts";
import { HostPause } from "./host-pause.ts";
import { templateRootOf } from "./spec-template.ts";
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
  const module: DomainModule<"hostPause"> = { server: { hostPause: server } };
  return { modules: [module] as const, hostPause };
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

/** What the daemon's board is built from (issue #1593). */
export interface BoardDeps
  extends Pick<
    BoardOptions,
    | "db"
    | "manager"
    | "preparePersonas"
    | "folderLocks"
    | "quota"
    | "budgets"
    | "memory"
    | "pause"
    | "checkLoop"
    | "projectKeys"
    | "cardCost"
    | "idle"
    | "suspendApproval"
    | "log"
  > {
  config: Pick<Config, "allowedRoots" | "maxParallelRuns"> & {
    board: Pick<Config["board"], "prPollIntervalMs">;
  };
  configFile: string;
  /** A folder's trust, with its trusted checkout, as the library reads it. */
  trustForKnowledge(cwd: string): Promise<Parameters<typeof templateRootOf>[0]>;
  /** The vault's values, read at each scan. */
  vaultValues(): string[];
}

/** The board's options as the daemon builds them. */
export function boardOptions({
  config,
  configFile,
  trustForKnowledge,
  vaultValues,
  db,
  manager,
  preparePersonas,
  folderLocks,
  quota,
  budgets,
  memory,
  pause,
  checkLoop,
  projectKeys,
  cardCost,
  idle,
  suspendApproval,
  log,
}: BoardDeps): BoardOptions {
  return {
    db,
    manager,
    // Named one by one: a deps object built elsewhere cannot slip another board option through.
    ...present({
      preparePersonas,
      folderLocks,
      quota,
      budgets,
      memory,
      pause,
      checkLoop,
      projectKeys,
      cardCost,
      idle,
      suspendApproval,
      log,
    }),
    // Issue #78: a card's spec template comes from a trusted project's trusted checkout only.
    specTemplateRoot: async (cwd, own) =>
      templateRootOf(await trustForKnowledge(cwd), own ? cwd : undefined),
    // What goes public from a card (a PR, a merge message) is also checked against the vault's values.
    scanner: new SecretScanner(() => vaultValues()),
    allowedRoots: config.allowedRoots,
    maxParallelRuns: config.maxParallelRuns,
    ...present({ prPollIntervalMs: config.board.prPollIntervalMs || undefined }),
    // Changed from the app: kept in the config file, like the rest of the host settings.
    onSettingsChange: ({ maxParallelRuns }) =>
      updateConfigFile(configFile, (raw) => ({ ...raw, maxParallelRuns })),
  };
}

/** The daemon's board; `start` and `warmProjectKeys` are left to the caller. */
export function createBoard(deps: BoardDeps): Board {
  return new Board(boardOptions(deps));
}
