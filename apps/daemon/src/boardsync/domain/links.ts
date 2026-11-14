/**
 * Phase 38: a project's link to an external board, and what the sync's rules ask of the place that
 * keeps the links. The SQLite store implements it; the rules never see the database (#1601).
 */
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

/** The board links as the rules read and change them. */
export interface BoardLinks {
  get(projectId: string): BoardLink | null;
  list(): BoardLink[];
  update(
    projectId: string,
    patch: Partial<Omit<BoardLink, "projectId" | "provider" | "boardId">>,
  ): BoardLink;
}
