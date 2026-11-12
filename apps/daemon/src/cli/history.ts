/**
 * The history command of the command line (issue #1593): `flightdeckd history reindex`, over the
 * history domain's index of the transcripts.
 */

import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { HistoryIndexer } from "../history/index.ts";
import { AlreadyRunningError, acquireLock, type Logger } from "../kernel/index.ts";
import { historyExcludes } from "../permissions/index.ts";
import { EventStore } from "../store/index.ts";
import { type CliArgs, configPath } from "./args.ts";

/** What the history command needs of the command line's deps (main.ts's `CliDeps`). */
export interface HistoryCommandDeps {
  log: Logger;
}

/**
 * `flightdeckd history reindex`: drops the transcript index and builds it again. Takes the
 * daemon's lock, so it refuses (exit 3) while a daemon uses the same `dataDir`.
 */
export async function runReindex(args: CliArgs, deps: HistoryCommandDeps): Promise<void> {
  const config = await loadConfig(configPath(args));
  const lock = await acquireLock(config.dataDir);
  if (!lock) {
    throw new AlreadyRunningError(config.dataDir, "stop the daemon before rebuilding the index");
  }
  // The lock goes back even when the store does not open (#1676).
  try {
    const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
    try {
      const history = new HistoryIndexer({
        db: store.db,
        roots: config.history.roots,
        excludeCwds: historyExcludes(config),
      });
      const { sessions, messages } = await history.rebuild();
      deps.log.log(`history rebuilt: ${sessions} sessions, ${messages} messages`);
    } finally {
      store.close();
    }
  } finally {
    await lock.release();
  }
}
