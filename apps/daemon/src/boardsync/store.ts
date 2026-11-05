/** Phase 38: what the sync keeps in the database: the board links, the cards' external fields, the log. */
import type { Database } from "bun:sqlite";
import { FlightdeckError } from "../errors.ts";
import type { ColumnMap } from "./map.ts";

export interface BoardLink {
  projectId: string;
  provider: string;
  boardId: string;
  boardTitle: string;
  statusFieldId: string;
  columnMap: ColumnMap;
  push: boolean;
  cursor: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  truncated: boolean;
  pausedUntil: string | null;
}

export interface CardExternal {
  externalId: string | null;
  externalUrl: string | null;
  externalStatus: string | null;
  externalUpdatedAt: string | null;
  localMovedAt: string | null;
  externalGone: boolean;
}

export interface SyncLogEntry {
  at: string;
  kind: string;
  winner: "local" | "external" | null;
  lostValue: string | null;
  lostAt: string | null;
  keptValue: string | null;
  keptAt: string | null;
  detail: string | null;
}

export const LOG_LIMIT = 50;

const refuse = (reason: string, message: string) =>
  new FlightdeckError("invalid_state", message, reason);

interface LinkRow {
  project_id: string;
  provider: string;
  board_id: string;
  board_title: string;
  status_field_id: string;
  column_map: string;
  push: number;
  cursor: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  truncated: number;
  paused_until: string | null;
}

interface CardRow {
  external_id: string | null;
  external_url: string | null;
  external_status: string | null;
  external_updated_at: string | null;
  local_moved_at: string | null;
  external_gone: number;
}

const toLink = (row: LinkRow): BoardLink => ({
  projectId: row.project_id,
  provider: row.provider,
  boardId: row.board_id,
  boardTitle: row.board_title,
  statusFieldId: row.status_field_id,
  columnMap: JSON.parse(row.column_map) as ColumnMap,
  push: row.push === 1,
  cursor: row.cursor,
  lastSyncedAt: row.last_synced_at,
  lastError: row.last_error,
  truncated: row.truncated === 1,
  pausedUntil: row.paused_until,
});

/** A booleans is stored as 0 or 1; any other value as it is. */
function sqlValue(value: unknown): string | number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as string | null;
}
export class BoardSyncStore {
  constructor(private readonly db: Database) {}

  link(input: {
    projectId: string;
    provider: string;
    boardId: string;
    boardTitle: string;
    statusFieldId: string;
    columnMap: ColumnMap;
  }): BoardLink {
    if (this.get(input.projectId)) {
      throw refuse("board_sync_already_linked", "the project already has a linked board");
    }
    this.db
      .query(
        `INSERT INTO board_links (project_id, provider, board_id, board_title, status_field_id, column_map)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.provider,
        input.boardId,
        input.boardTitle,
        input.statusFieldId,
        JSON.stringify(input.columnMap),
      );
    return this.get(input.projectId) as BoardLink;
  }

  get(projectId: string): BoardLink | null {
    const row = this.db
      .query<LinkRow, [string]>("SELECT * FROM board_links WHERE project_id = ?")
      .get(projectId);
    return row ? toLink(row) : null;
  }

  list(): BoardLink[] {
    return this.db
      .query<LinkRow, []>("SELECT * FROM board_links ORDER BY project_id")
      .all()
      .map(toLink);
  }

  /** The link goes; the cards keep their external fields and stop syncing. */
  unlink(projectId: string): void {
    if (!this.get(projectId))
      throw refuse("board_sync_not_linked", "the project has no linked board");
    this.db.query("DELETE FROM board_links WHERE project_id = ?").run(projectId);
  }

  update(
    projectId: string,
    patch: Partial<Omit<BoardLink, "projectId" | "provider" | "boardId">>,
  ): BoardLink {
    const now = this.get(projectId);
    if (!now) throw refuse("board_sync_not_linked", "the project has no linked board");
    const next = { ...now, ...patch };
    this.db
      .query(
        `UPDATE board_links SET board_title = ?, status_field_id = ?, column_map = ?, push = ?,
           cursor = ?, last_synced_at = ?, last_error = ?, truncated = ?, paused_until = ?
         WHERE project_id = ?`,
      )
      .run(
        next.boardTitle,
        next.statusFieldId,
        JSON.stringify(next.columnMap),
        next.push ? 1 : 0,
        next.cursor,
        next.lastSyncedAt,
        next.lastError,
        next.truncated ? 1 : 0,
        next.pausedUntil,
        projectId,
      );
    return this.get(projectId) as BoardLink;
  }

  /** Sets the fields given (null clears one); the others stay. */
  setExternal(cardId: string, patch: Partial<CardExternal>): void {
    const columns: Record<keyof CardExternal, string> = {
      externalId: "external_id",
      externalUrl: "external_url",
      externalStatus: "external_status",
      externalUpdatedAt: "external_updated_at",
      localMovedAt: "local_moved_at",
      externalGone: "external_gone",
    };
    for (const [key, value] of Object.entries(patch) as Array<[keyof CardExternal, unknown]>) {
      if (value === undefined) continue;
      this.db
        .query(`UPDATE cards SET ${columns[key]} = ? WHERE id = ?`)
        .run(sqlValue(value), cardId);
    }
  }

  externalOf(cardId: string): CardExternal {
    const row = this.db
      .query<CardRow, [string]>(
        `SELECT external_id, external_url, external_status, external_updated_at, local_moved_at,
           external_gone FROM cards WHERE id = ?`,
      )
      .get(cardId);
    return {
      externalId: row?.external_id ?? null,
      externalUrl: row?.external_url ?? null,
      externalStatus: row?.external_status ?? null,
      externalUpdatedAt: row?.external_updated_at ?? null,
      localMovedAt: row?.local_moved_at ?? null,
      externalGone: row?.external_gone === 1,
    };
  }

  /** The ids of the project's cards that have an external id. */
  linkedCards(projectId: string): string[] {
    return this.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE project_id = ? AND external_id IS NOT NULL",
      )
      .all(projectId)
      .map((row) => row.id);
  }

  cardByExternal(projectId: string, externalId: string): string | null {
    return (
      this.db
        .query<{ id: string }, [string, string]>(
          "SELECT id FROM cards WHERE project_id = ? AND external_id = ?",
        )
        .get(projectId, externalId)?.id ?? null
    );
  }

  /** Appends an entry; only the last `LOG_LIMIT` of the card are kept. */
  addLog(cardId: string, entry: SyncLogEntry): void {
    this.db
      .query(
        `INSERT INTO card_sync_log (card_id, at, kind, winner, lost_value, lost_at, kept_value, kept_at, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        entry.at,
        entry.kind,
        entry.winner,
        entry.lostValue,
        entry.lostAt,
        entry.keptValue,
        entry.keptAt,
        entry.detail,
      );
    this.db
      .query(
        `DELETE FROM card_sync_log WHERE card_id = ? AND id NOT IN
           (SELECT id FROM card_sync_log WHERE card_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(cardId, cardId, LOG_LIMIT);
  }

  /** The card's log, newest first. */
  logOf(cardId: string): SyncLogEntry[] {
    return this.db
      .query<
        {
          at: string;
          kind: string;
          winner: "local" | "external" | null;
          lost_value: string | null;
          lost_at: string | null;
          kept_value: string | null;
          kept_at: string | null;
          detail: string | null;
        },
        [string]
      >("SELECT * FROM card_sync_log WHERE card_id = ? ORDER BY id DESC")
      .all(cardId)
      .map((row) => ({
        at: row.at,
        kind: row.kind,
        winner: row.winner,
        lostValue: row.lost_value,
        lostAt: row.lost_at,
        keptValue: row.kept_value,
        keptAt: row.kept_at,
        detail: row.detail,
      }));
  }
}
