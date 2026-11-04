import { z } from "zod";
import type { T } from "../i18n/index.ts";
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
  /** Where a click goes when `route` is a card that is gone: its pull request. */
  fallbackUrl?: string;
  /** What the notification is about: the session, card or team, named. */
  subject?: string;
  /** The host it happened on. */
  host?: string;
  /** The request in plain words ("Asks: which DB?"), not the tool's name. */
  ask?: string;
  /** Notifications of one thing (one session's questions) share it, so a burst collapses. */
  group?: string;
  read: boolean;
}

/** What a click on an entry does. */
export type InboxTarget =
  | { kind: "link"; link: string }
  | { kind: "route"; route: Route }
  | { kind: "url"; url: string };

/** Where a click on `entry` goes; `cardExists` says whether a card route still has its card. */
export function inboxTarget(
  entry: InboxEntry,
  cardExists: (route: Extract<Route, { name: "card" }>) => boolean,
): InboxTarget | null {
  if (entry.link) return { kind: "link", link: entry.link };
  const { route } = entry;
  if (!route) return null;
  if (route.name === "card" && entry.fallbackUrl && !cardExists(route)) {
    return { kind: "url", url: entry.fallbackUrl };
  }
  return { kind: "route", route };
}

export type InboxDay = "today" | "yesterday" | string;

/** The newest entry goes first; only the newest `cap` are kept. */
export function addEntry(
  list: InboxEntry[],
  entry: InboxEntry,
  cap: number = INBOX_CAP,
): InboxEntry[] {
  return [entry, ...list].slice(0, cap);
}

export function markRead(list: InboxEntry[], id: string): InboxEntry[] {
  return list.map((e) => (e.id === id ? { ...e, read: true } : e));
}

export function markAllRead(list: InboxEntry[]): InboxEntry[] {
  return list.map((e) => (e.read ? e : { ...e, read: true }));
}

export function unreadCount(list: InboxEntry[]): number {
  return list.filter((e) => !e.read).length;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Newest first, grouped by local calendar day: "today", "yesterday" or "YYYY-MM-DD". */
export function groupByDay(
  list: InboxEntry[],
  now: Date,
): Array<{ day: InboxDay; entries: InboxEntry[] }> {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: Array<{ day: InboxDay; entries: InboxEntry[] }> = [];
  const sorted = [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const entry of sorted) {
    const key = dayKey(new Date(entry.at));
    const day = key === today ? "today" : key === yesterday ? "yesterday" : key;
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

const Stored = z.array(
  z.object({
    id: z.string(),
    at: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().optional(),
    route: z.custom<Route>((v) => typeof v === "object" && v !== null && "name" in v).optional(),
    fallbackUrl: z.string().optional(),
    subject: z.string().optional(),
    host: z.string().optional(),
    ask: z.string().optional(),
    group: z.string().optional(),
    read: z.boolean(),
  }),
);

export function loadInbox(storage: { getItem(key: string): string | null }): InboxEntry[] {
  try {
    return Stored.parse(JSON.parse(storage.getItem(INBOX_KEY) ?? "[]")) as InboxEntry[];
  } catch {
    return [];
  }
}

export function saveInbox(
  storage: { setItem(key: string, value: string): void },
  list: InboxEntry[],
): void {
  storage.setItem(INBOX_KEY, JSON.stringify(list));
}

/** One line of the panel: the newest of the entries it stands for, and how many there are. */
export interface InboxRow {
  entry: InboxEntry;
  /** The ids of every entry collapsed into the row (the newest first). */
  ids: string[];
  count: number;
}

export type InboxSection = "today" | "earlier";

/**
 * What the panel draws: Today then Earlier; in each, unread rows first and then by time. Entries of
 * one `group` that are both unread, or both read, on the same side of midnight collapse into one row.
 */
export function inboxRows(
  _list: InboxEntry[],
  _now: Date,
): Array<{ section: InboxSection; rows: InboxRow[] }> {
  return [];
}

/** The badge: the unread rows, which are the dots the panel shows. */
export function unreadRows(_list: InboxEntry[], _now: Date): number {
  return 0;
}

/** A request in plain words, from the tool and its input. */
export function describeRequest(
  _toolName: string,
  _input: Record<string, unknown> | undefined,
  _t: T,
): string {
  return "";
}
