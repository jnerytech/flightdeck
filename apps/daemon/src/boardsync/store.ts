/** Phase 38: what the sync keeps in the database: the board links, the cards' external fields, the log. */
import type { Database } from "bun:sqlite";
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

export class BoardSyncStore {
  constructor(private readonly db: Database) {}

  link(_input: {
    projectId: string;
    provider: string;
    boardId: string;
    boardTitle: string;
    statusFieldId: string;
    columnMap: ColumnMap;
  }): BoardLink {
    void this.db;
    throw new Error("not implemented");
  }

  get(_projectId: string): BoardLink | null {
    return null;
  }

  list(): BoardLink[] {
    return [];
  }

  unlink(_projectId: string): void {}

  update(
    _projectId: string,
    _patch: Partial<Omit<BoardLink, "projectId" | "provider" | "boardId">>,
  ): BoardLink {
    throw new Error("not implemented");
  }

  setExternal(_cardId: string, _patch: Partial<CardExternal>): void {}

  externalOf(_cardId: string): CardExternal {
    return {
      externalId: "",
      externalUrl: "",
      externalStatus: "",
      externalUpdatedAt: "",
      localMovedAt: "",
      externalGone: true,
    };
  }

  cardByExternal(_projectId: string, _externalId: string): string | null {
    return "";
  }

  addLog(_cardId: string, _entry: SyncLogEntry): void {}

  logOf(_cardId: string): SyncLogEntry[] {
    return [];
  }
}
