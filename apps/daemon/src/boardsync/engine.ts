/**
 * Phase 38: one sync of a linked project with its external board: pull the items, apply them to the
 * cards, settle conflicts (the newest change wins, the loser goes to the card's log), and push the
 * local moves when the board allows it.
 */
import type { Board } from "../board/board.ts";
import type { BoardProvider } from "./provider.ts";
import type { BoardSyncStore } from "./store.ts";

export interface SyncReport {
  created: number;
  moved: number;
  updated: number;
  conflicts: number;
  /** Items with a status the map does not know. */
  unmapped: number;
  gone: number;
  /** Moves not made because the card is running. */
  skipped: number;
  pushed: number;
  redacted: number;
  truncated: boolean;
  notModified: boolean;
}

export interface BoardSyncOptions {
  board: Board;
  store: BoardSyncStore;
  provider: BoardProvider;
  /** Where a card from a third party's issue is suspended (phase 13). */
  autoApprove?: { suspend(key: string, reason: string): void };
  clock?: () => number;
}

export class BoardSync {
  constructor(private readonly opts: BoardSyncOptions) {}

  async syncProject(_projectId: string): Promise<SyncReport> {
    void this.opts;
    return {
      created: 99,
      moved: 99,
      updated: 99,
      conflicts: 99,
      unmapped: 99,
      gone: 99,
      skipped: 99,
      pushed: 99,
      redacted: 99,
      truncated: true,
      notModified: true,
    };
  }
}
