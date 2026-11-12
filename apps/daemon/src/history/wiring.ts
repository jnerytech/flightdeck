import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import { adoptTitles, type Names, type TrackOptions } from "../names/index.ts";
import { historyExcludes } from "../permissions/index.ts";
import { present } from "../present.ts";
import { HistoryIndexer } from "./indexer.ts";

/** What the index of Claude Code's recorded conversations is built from. */
export interface HistoryDeps {
  db: Database;
  config: Pick<Config, "dataDir" | "history">;
  /** Every session of this host has a standard name; a title Claude Code gave one is adopted (#605). */
  names: Names;
  manager: Pick<TrackOptions["manager"], "list">;
  log: (line: string) => void;
}

/**
 * The index of the conversations Claude Code recorded on this host (#1593): its roots and
 * exclusions come from the config, and a session's title reaches its name. Not started here.
 */
export function createHistory({ db, config, names, manager, log }: HistoryDeps): HistoryIndexer {
  return new HistoryIndexer({
    db,
    roots: config.history.roots,
    excludeCwds: historyExcludes(config),
    log,
    // Issue #605: the name Claude Code gave a session (`--name`, `/rename`) is its name here too.
    onTitle: adoptTitles(names, manager),
    ...present({ scanIntervalMs: config.history.scanIntervalMs || undefined }),
  });
}
