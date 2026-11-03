import { describe, expect, test } from "bun:test";
import {
  addEntry,
  groupByDay,
  INBOX_CAP,
  INBOX_KEY,
  type InboxEntry,
  loadInbox,
  markAllRead,
  markRead,
  saveInbox,
  unreadCount,
} from "../src/lib/inbox.ts";

const entry = (id: string, at: string, read = false): InboxEntry => ({
  id,
  at,
  title: `t${id}`,
  body: "b",
  read,
});

describe("inbox", () => {
  test("a new entry goes first, and the list keeps the newest INBOX_CAP", () => {
    let list: InboxEntry[] = [];
    for (let i = 0; i < INBOX_CAP + 5; i++)
      list = addEntry(list, entry(String(i), "2026-11-03T10:00:00Z"));
    expect(list).toHaveLength(INBOX_CAP);
    expect(list[0]?.id).toBe(String(INBOX_CAP + 4));
    expect(list.at(-1)?.id).toBe("5");
  });

  test("unread count, mark one, mark all", () => {
    const list = [entry("a", "2026-11-03T10:00:00Z"), entry("b", "2026-11-03T09:00:00Z", true)];
    expect(unreadCount(list)).toBe(1);
    expect(unreadCount(markRead(list, "a"))).toBe(0);
    expect(
      unreadCount(
        markAllRead([entry("x", "2026-11-03T10:00:00Z"), entry("y", "2026-11-03T10:00:00Z")]),
      ),
    ).toBe(0);
    expect(markRead(list, "nope")).toEqual(list);
  });

  test("groups by local day: today, yesterday, then the date, newest first", () => {
    const now = new Date(2026, 10, 3, 12, 0, 0);
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).toISOString();
    const groups = groupByDay(
      [
        entry("old", at(1, 8)),
        entry("y", at(2, 23)),
        entry("t1", at(3, 9)),
        entry("t2", at(3, 11)),
      ],
      now,
    );
    expect(groups.map((g) => g.day)).toEqual(["today", "yesterday", "2026-11-01"]);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["t2", "t1"]);
  });

  test("saves and loads; a corrupt value loads as empty", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const list = [
      { ...entry("a", "2026-11-03T10:00:00Z"), link: "flightdeck://request?host=h&request=r" },
    ];
    saveInbox(storage, list);
    expect(store.has(INBOX_KEY)).toBe(true);
    expect(loadInbox(storage)).toEqual(list);
    store.set(INBOX_KEY, "{not json");
    expect(loadInbox(storage)).toEqual([]);
  });
});
