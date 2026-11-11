import type { Database } from "bun:sqlite";
import { BoardSync, type BoardSyncOptions } from "./engine.ts";
import { GithubBoards, type GithubBoardsOptions } from "./github.ts";
import { BoardSyncLoop } from "./loop.ts";
import { BoardSyncService } from "./service.ts";
import { BoardSyncStore } from "./store.ts";

/** What the sync of the GitHub Projects boards is built from. */
export interface BoardSyncDeps {
  db: Database;
  board: BoardSyncOptions["board"];
  autoApprove: BoardSyncOptions["autoApprove"];
  gh: GithubBoardsOptions["gh"];
}

/**
 * Phase 38 (issue #1593): the boards of GitHub Projects, read through the host's gh and synced on
 * a timer. The caller starts and stops the loop, in its own boot and shutdown order.
 */
export function createBoardSync({ db, board, autoApprove, gh }: BoardSyncDeps) {
  const store = new BoardSyncStore(db);
  const provider = new GithubBoards({ gh });
  const engine = new BoardSync({ board, store, provider, autoApprove });
  const loop = new BoardSyncLoop({
    engine,
    store,
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as Timer) },
  });
  return { service: new BoardSyncService({ board, store, provider, engine, loop }), loop };
}
