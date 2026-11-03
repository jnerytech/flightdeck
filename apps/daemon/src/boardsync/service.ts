/**
 * Phase 38: the `boardsync.*` commands behind one object: the provider's boards, linking a project
 * to one, its map, the push switch, the status, an immediate sync, and a card's conflict log.
 */
import type { BoardColumn, BoardSyncStatus } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import type { BoardSync, SyncReport } from "./engine.ts";
import type { BoardSyncLoop } from "./loop.ts";
import type { ColumnMap } from "./map.ts";
import type { BoardProvider, ExternalBoard } from "./provider.ts";
import type { BoardSyncStore, SyncLogEntry } from "./store.ts";

export interface BoardSyncServiceOptions {
  board: Board;
  store: BoardSyncStore;
  provider: BoardProvider;
  engine: BoardSync;
  loop: BoardSyncLoop;
}

export class BoardSyncService {
  constructor(private readonly opts: BoardSyncServiceOptions) {}

  async boards(): Promise<ExternalBoard[]> {
    void this.opts;
    return [];
  }

  async link(_input: {
    projectId: string;
    boardId: string;
    columnMap?: Partial<Record<string, BoardColumn>>;
  }): Promise<BoardSyncStatus> {
    return { linked: true } as BoardSyncStatus;
  }

  unlink(_projectId: string): void {}

  async setMap(_projectId: string, _columnMap: ColumnMap): Promise<BoardSyncStatus> {
    return { linked: true } as BoardSyncStatus;
  }

  async setPush(_projectId: string, _push: boolean, _confirm: boolean): Promise<BoardSyncStatus> {
    return { linked: true } as BoardSyncStatus;
  }

  status(_projectId: string): BoardSyncStatus {
    return { linked: true } as BoardSyncStatus;
  }

  async syncNow(_projectId: string): Promise<{ status: BoardSyncStatus; report: SyncReport }> {
    return { status: { linked: true } as BoardSyncStatus, report: {} as SyncReport };
  }

  log(_cardId: string): SyncLogEntry[] {
    return [];
  }
}
