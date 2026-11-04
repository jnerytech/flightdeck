import { describe, expect, test } from "bun:test";
import {
  addEntry,
  groupByDay,
  INBOX_CAP,
  INBOX_KEY,
  type InboxEntry,
  inboxTarget,
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

  test("the day is the local one even when the UTC date is already another (late evening, early morning)", () => {
    const local = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m, 0);
    // 23:30 local: in any zone east of UTC-0 minus a few hours the UTC date is already tomorrow's.
    const late = groupByDay(
      [
        entry("night", local(3, 23, 20).toISOString()),
        entry("dawn", local(3, 0, 10).toISOString()),
        entry("before", local(2, 23, 50).toISOString()),
      ],
      local(3, 23, 30),
    );
    expect(late.map((g) => [g.day, g.entries.map((e) => e.id)])).toEqual([
      ["today", ["night", "dawn"]],
      ["yesterday", ["before"]],
    ]);
    // 00:30 local: an hour ago is still yesterday, whatever the UTC date says.
    const early = groupByDay(
      [entry("now", local(3, 0, 30).toISOString()), entry("hour", local(2, 23, 30).toISOString())],
      local(3, 0, 30),
    );
    expect(early.map((g) => g.day)).toEqual(["today", "yesterday"]);
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

describe("inbox: where a click goes", () => {
  const card = { name: "card", host: "h", projectId: "p", cardId: "c" } as const;
  const base = { id: "1", at: "2026-11-03T10:00:00Z", title: "t", body: "b", read: false };
  const there = () => true;
  const gone = () => false;

  test("a request link wins over the route", () => {
    const e: InboxEntry = { ...base, link: "flightdeck://r/1", route: { name: "teams" } };
    expect(inboxTarget(e, there)).toEqual({ kind: "link", link: "flightdeck://r/1" });
  });

  test("a route opens as it is, with its params", () => {
    const e: InboxEntry = { ...base, route: { name: "costs", host: "h", projectKey: "/a" } };
    expect(inboxTarget(e, there)).toEqual({
      kind: "route",
      route: { name: "costs", host: "h", projectKey: "/a" },
    });
  });

  test("a card that is still there opens, a card that is gone opens its pull request", () => {
    const e: InboxEntry = { ...base, route: card, fallbackUrl: "https://git.test/pr/7" };
    expect(inboxTarget(e, there)).toEqual({ kind: "route", route: card });
    expect(inboxTarget(e, gone)).toEqual({ kind: "url", url: "https://git.test/pr/7" });
  });

  test("a card that is gone with no pull request still tries the route", () => {
    expect(inboxTarget({ ...base, route: card }, gone)).toEqual({ kind: "route", route: card });
  });

  test("an entry with nowhere to go has no target, and the fallback url survives storage", () => {
    expect(inboxTarget(base, there)).toBeNull();
    const kept = new Map<string, string>();
    saveInbox({ setItem: (k, v) => kept.set(k, v) }, [
      { ...base, route: card, fallbackUrl: "https://git.test/pr/7" },
    ]);
    expect(loadInbox({ getItem: (k) => kept.get(k) ?? null })[0]?.fallbackUrl).toBe(
      "https://git.test/pr/7",
    );
  });
});
