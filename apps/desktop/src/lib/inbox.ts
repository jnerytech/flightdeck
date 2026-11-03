import type { Route } from "./router.ts";

export const INBOX_KEY = "flightdeck.inbox";
/** Entries kept; the oldest go first. */
export const INBOX_CAP = 500;

/** One notification the app sent, kept for the notification center. */
export interface InboxEntry {
  id: string;
  /** ISO time it was sent. */
  at: string;
  title: string;
  body: string;
  /** `flightdeck://` link of a request: a click opens it. */
  link?: string;
  /** The screen a click opens, when it is not a request. */
  route?: Route;
  read: boolean;
}

export type InboxDay = "today" | "yesterday" | string;

export function addEntry(
  list: InboxEntry[],
  _entry: InboxEntry,
  _cap: number = INBOX_CAP,
): InboxEntry[] {
  return list;
}

export function markRead(list: InboxEntry[], _id: string): InboxEntry[] {
  return list;
}

export function markAllRead(list: InboxEntry[]): InboxEntry[] {
  return list;
}

export function unreadCount(_list: InboxEntry[]): number {
  return -1;
}

/** Newest first, grouped by local calendar day: "today", "yesterday" or "YYYY-MM-DD". */
export function groupByDay(
  _list: InboxEntry[],
  _now: Date,
): Array<{ day: InboxDay; entries: InboxEntry[] }> {
  return [];
}

export function loadInbox(_storage: { getItem(key: string): string | null }): InboxEntry[] {
  return [];
}

export function saveInbox(
  _storage: { setItem(key: string, value: string): void },
  _list: InboxEntry[],
): void {}
