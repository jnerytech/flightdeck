import { describe, expect, test } from "bun:test";
import { InboxSlice } from "../src/features/inbox/index.ts";
import type { InboxEntry } from "../src/lib/inbox.ts";
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from "../src/lib/notify-policy.ts";
import { requestLink } from "../src/lib/request-link.ts";

/**
 * A notification center over stand-ins: what the system showed, the badges the taskbar was told,
 * the keys of what waits, the hosts that are up, and the storage the entries are kept in.
 */
function inbox(
  over: {
    prefs?: Partial<NotifyPrefs>;
    shown?: boolean;
    saved?: string;
    badgeFails?: boolean;
  } = {},
) {
  let entries: InboxEntry[] = [];
  let waiting: string[] = [];
  const online = new Set<string>(["h"]);
  const shown: string[] = [];
  const badges: number[] = [];
  const kept = new Map<string, string>(over.saved ? [["flightdeck.inbox", over.saved]] : []);
  const slice = new InboxSlice({
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
    },
    entries: () => entries,
    setEntries: (next) => {
      entries = next;
    },
    prefs: () => ({ ...DEFAULT_NOTIFY_PREFS, ...over.prefs }),
    soundFile: () => null,
    waiting: () => waiting,
    hostOnline: (id) => online.has(id),
    now: () => Date.parse("2026-11-11T12:00:00Z"),
    show: async (n) => {
      shown.push(n.title);
      return over.shown ?? true;
    },
    setBadge: async (count) => {
      badges.push(count);
      if (over.badgeFails) throw new Error("the taskbar refused");
    },
    t: () => ((key: string) => key) as never,
  });
  let plays = 0;
  slice.soundPlayer = () => void plays++;
  return {
    slice,
    entries: () => entries,
    shown,
    badges,
    plays: () => plays,
    kept,
    wait: (keys: string[]) => {
      waiting = keys;
      slice.rememberWaiting();
    },
    hostDown: () => online.delete("h"),
  };
}

describe("inbox slice", () => {
  test("a notification reaches the bell, the system and the sound by what the person chose", () => {
    const on = inbox({ prefs: { sound: { mode: "system", volume: 0.5, fileName: null } } });
    on.slice.notify({ title: "a", body: "b", about: { subject: "s", host: "alfa", ask: "q" } });
    expect(on.entries().map((e) => [e.title, e.subject, e.host, e.ask, e.read])).toEqual([
      ["a", "s", "alfa", "q", false],
    ]);
    expect([on.shown, on.plays()]).toEqual([["a"], 1]);

    const off = inbox({ prefs: { enabled: false } });
    off.slice.notify({ title: "a", body: "b" });
    expect(off.entries()).toHaveLength(1);
    expect([off.shown, off.plays()]).toEqual([[], 0]);
  });

  test("a muted source is told to no one, and a switched-off event neither", () => {
    const muted = inbox({ prefs: { mutedHosts: ["h"] } });
    muted.slice.notify({ title: "a", body: "" }, undefined, undefined, {
      event: "other",
      hostId: "h",
    });
    const switched = inbox({
      prefs: { events: { ...DEFAULT_NOTIFY_PREFS.events, "turn-finished": false } },
    });
    switched.slice.notify({ title: "a", body: "", event: "turn-finished" });
    expect([muted.entries(), muted.shown, switched.entries(), switched.shown]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });

  test("an entry keeps its route and fallback, the newest first, and is saved", () => {
    const w = inbox();
    w.slice.notify({ title: "first", body: "" });
    w.slice.notify(
      { title: "second", body: "" },
      { name: "settings", section: "backup" },
      "https://pr",
    );
    expect(w.entries().map((e) => e.title)).toEqual(["second", "first"]);
    expect(w.entries()[0]?.route).toEqual({ name: "settings", section: "backup" });
    expect(w.entries()[0]?.fallbackUrl).toBe("https://pr");
    w.slice.markAllRead();
    expect(
      JSON.parse(w.kept.get("flightdeck.inbox") ?? "[]").every((e: InboxEntry) => e.read),
    ).toBe(true);
  });

  test("load brings back what a previous run kept", () => {
    const saved = JSON.stringify([
      { id: "e1", at: "2026-11-10T10:00:00.000Z", title: "old", body: "", read: false },
    ]);
    const w = inbox({ saved });
    w.slice.load();
    expect(w.entries().map((e) => e.title)).toEqual(["old"]);
  });

  test("read, unread, dismiss and clear change the entries and the badge", async () => {
    const w = inbox();
    w.slice.notify({ title: "a", body: "", about: { subject: "s1", host: "h", group: "g1" } });
    w.slice.notify({ title: "b", body: "", about: { subject: "s2", host: "h", group: "g2" } });
    const [b, a] = w.entries().map((e) => e.id) as [string, string];
    expect(w.badges.at(-1)).toBe(2);
    w.slice.markRead(a);
    expect(w.badges.at(-1)).toBe(1);
    w.slice.markUnread([a]);
    expect(w.badges.at(-1)).toBe(2);
    w.slice.dismiss([b]);
    expect(w.entries().map((e) => e.id)).toEqual([a]);
    w.slice.clear();
    expect([w.entries(), w.badges.at(-1)]).toEqual([[], 0]);
  });

  test("the badge is told only when the count changes, and again on request", () => {
    const w = inbox();
    w.slice.syncBadge();
    w.slice.resendBadge();
    expect(w.badges).toEqual([]);
    w.slice.notify({ title: "a", body: "" });
    w.slice.syncBadge();
    w.slice.resendBadge();
    expect(w.badges).toEqual([1, 1]);
  });

  test("a taskbar that refuses the badge does not stop the notification", async () => {
    const w = inbox({ badgeFails: true });
    w.slice.notify({ title: "a", body: "" });
    w.slice.resendBadge();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([w.entries().length, w.badges]).toEqual([1, [1, 1]]);
  });

  test("a request answered since it was sent leaves the bell, one never seen waiting does not", () => {
    const w = inbox();
    const link = requestLink("h", "r1");
    w.slice.notify({ title: "ask", body: "", link, about: { subject: "s", host: "h" } });
    w.slice.notify({
      title: "ask2",
      body: "",
      link: requestLink("h", "r2"),
      about: { subject: "s", host: "h" },
    });
    expect(w.slice.visible()).toHaveLength(2);
    w.wait(["h/r1"]);
    expect(w.slice.requestAnswered("h", "r1")).toBe(false);
    w.wait([]);
    expect(w.slice.requestAnswered("h", "r1")).toBe(true);
    expect(w.slice.requestAnswered("h", "r2")).toBe(false);
    expect(w.slice.visible().map((e) => e.title)).toEqual(["ask2"]);
    w.hostDown();
    expect(w.slice.requestAnswered("h", "r1")).toBe(false);
  });

  test("the test notification says whether the system showed it, and rings only when it did", async () => {
    const shown = inbox({ shown: true });
    expect(await shown.slice.sendTest()).toBe("delivered");
    expect([shown.shown, shown.plays()]).toEqual([["notify.testTitle"], 1]);
    const blocked = inbox({ shown: false });
    expect(await blocked.slice.sendTest()).toBe("blocked");
    expect(blocked.plays()).toBe(0);
  });
});
