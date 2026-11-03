/**
 * Phase 38: the `boardsync.*` commands behind one object: the provider's boards, linking a project
 * to one, its map, the push switch, the status, an immediate sync, and a card's conflict log.
 */
import type { BoardColumn, BoardSyncStatus } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import { FlightdeckError } from "../errors.ts";
import type { BoardSync, SyncReport } from "./engine.ts";
import type { BoardSyncLoop } from "./loop.ts";
import { type ColumnMap, checkMap, defaultMapFor } from "./map.ts";
import type { BoardProvider, ExternalBoard } from "./provider.ts";
import { setPush } from "./push.ts";
import type { BoardSyncStore, SyncLogEntry } from "./store.ts";

export interface BoardSyncServiceOptions {
  board: Board;
  store: BoardSyncStore;
  provider: BoardProvider;
  engine: BoardSync;
  loop: BoardSyncLoop;
}

const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

export class BoardSyncService {
  constructor(private readonly opts: BoardSyncServiceOptions) {}

  boards(): Promise<ExternalBoard[]> {
    return this.opts.provider.listBoards();
  }

  /** Links the project to a board, with the map given or the default one, and syncs once. */
  async link(input: {
    projectId: string;
    boardId: string;
    columnMap?: Partial<Record<string, BoardColumn>>;
  }): Promise<BoardSyncStatus> {
    const { board, store, provider, loop } = this.opts;
    board.getProject(input.projectId);
    if (store.get(input.projectId)) {
      throw refuse("board_sync_already_linked", "the project already has a linked board");
    }
    const field = await provider.statusField(input.boardId);
    if (!field) {
      throw refuse("board_sync_field_not_found", "the board has no Status field", {
        field: "Status",
      });
    }
    const columnMap: ColumnMap = (input.columnMap as ColumnMap | undefined) ?? {
      ...defaultMapFor(field.options),
      "No status": "backlog",
    };
    checkMap(columnMap, field.options);
    const boards = await provider.listBoards();
    store.link({
      projectId: input.projectId,
      provider: provider.kind,
      boardId: input.boardId,
      boardTitle:
        boards.find((candidate) => candidate.id === input.boardId)?.title ?? input.boardId,
      statusFieldId: field.fieldId,
      columnMap,
    });
    loop.watch(input.projectId);
    await loop.syncNow(input.projectId);
    return this.status(input.projectId);
  }

  unlink(projectId: string): void {
    this.opts.store.unlink(projectId);
    this.opts.loop.unwatch(projectId);
  }

  async setMap(projectId: string, columnMap: ColumnMap): Promise<BoardSyncStatus> {
    const { store, provider } = this.opts;
    const link = store.get(projectId);
    if (!link) throw refuse("board_sync_not_linked", "the project has no linked board");
    const field = await provider.statusField(link.boardId);
    if (!field) {
      throw refuse("board_sync_field_not_found", "the board has no Status field", {
        field: "Status",
      });
    }
    checkMap(columnMap, field.options);
    store.update(projectId, { columnMap });
    return this.status(projectId);
  }

  async setPush(projectId: string, push: boolean, confirm: boolean): Promise<BoardSyncStatus> {
    await setPush(
      { store: this.opts.store, provider: this.opts.provider },
      projectId,
      push,
      confirm,
    );
    return this.status(projectId);
  }

  status(projectId: string): BoardSyncStatus {
    const link = this.opts.store.get(projectId);
    if (!link) return { linked: false };
    return {
      linked: true,
      provider: link.provider,
      boardId: link.boardId,
      boardTitle: link.boardTitle,
      columnMap: link.columnMap,
      push: link.push,
      lastSyncedAt: link.lastSyncedAt,
      lastError: link.lastError,
      pausedUntil: link.pausedUntil,
      truncated: link.truncated,
    };
  }

  /** Syncs now; a failure is thrown with its reason (the loop would only have kept it on the link). */
  async syncNow(projectId: string): Promise<{ status: BoardSyncStatus; report: SyncReport }> {
    const { store, loop } = this.opts;
    if (!store.get(projectId))
      throw refuse("board_sync_not_linked", "the project has no linked board");
    const report = await loop.syncNow(projectId);
    if (!report) {
      const reason = store.get(projectId)?.lastError ?? "board_sync_failed";
      throw refuse(reason, `the board could not be synced: ${reason}`);
    }
    return { status: this.status(projectId), report };
  }

  log(cardId: string): SyncLogEntry[] {
    return this.opts.store.logOf(cardId);
  }
}
