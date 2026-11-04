/**
 * Phase 38: what the sync engine asks of an external board. GitHub Projects is the first provider;
 * the engine, the mapping, the conflict rule and the push rule know nothing about it. A provider
 * throws a `FlightdeckError` with a reason, never a raw error.
 */
import type { StatusOption } from "./map.ts";

export interface ExternalBoard {
  id: string;
  title: string;
  owner: string;
  number: number;
  url: string;
}

export interface ExternalItem {
  /** The provider's id of the item. */
  id: string;
  url: string;
  title: string;
  body: string;
  /** The Status option's name; null when the item has none. */
  status: string | null;
  /** ISO time of the item's last change at the provider. */
  updatedAt: string;
  archived: boolean;
  /** What the item is; null when the token cannot see it (redacted). */
  content: {
    kind: "issue" | "pull_request" | "draft";
    /** `github:owner/repo#n` for an issue or a pull request. */
    ref?: string;
    /** Written by someone outside the repository's people: third-party content. */
    external?: boolean;
  } | null;
}

export interface StatusField {
  fieldId: string;
  options: StatusOption[];
}

export interface PullResult {
  items: ExternalItem[];
  /** What to pass as `since` next time. */
  cursor: string;
  /** The provider says nothing changed since `since`; `items` is empty. */
  notModified: boolean;
  /** The board has more items than the provider reads in one pull. */
  truncated: boolean;
  /** Items the token could not see. */
  redacted: number;
}

export interface BoardProvider {
  readonly kind: string;
  scopes(): Promise<{ read: boolean; write: boolean }>;
  listBoards(): Promise<ExternalBoard[]>;
  /** The Status field of the board; null when it has none. */
  statusField(boardId: string): Promise<StatusField | null>;
  pull(boardId: string, since?: string): Promise<PullResult>;
  /** Sets the item's Status; needs the write scope. Answers the provider's time of the change. */
  setStatus(boardId: string, itemId: string, optionId: string): Promise<{ updatedAt: string }>;
}
