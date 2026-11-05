import { describe, expect, test } from "bun:test";
import { type InboxEntry, markUnread, unreadCount } from "../src/lib/inbox.ts";
import {
  DEFAULT_NOTIFY_PREFS,
  decide,
  NotifyPreferences,
  type NotifyPrefs,
  type NotifySource,
} from "../src/lib/notify-policy.ts";
import { playNotifySound } from "../src/lib/notify-sound.ts";
import type { Platform } from "../src/platform/types.ts";

const NOW = Date.parse("2026-11-04T10:00:00.000Z");
const prefs = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({
  ...DEFAULT_NOTIFY_PREFS,
  ...over,
  events: { ...DEFAULT_NOTIFY_PREFS.events, ...over.events },
});
const ALL = { os: true, bell: true, sound: true, fold: false };
const NONE = { os: false, bell: false, sound: false, fold: false };

describe("notify-prefs: who is told, where (issue #149)", () => {
  const cases: Array<[string, NotifyPrefs, NotifySource, ReturnType<typeof decide>]> = [
    ["by default everything is told", prefs(), { event: "needs-you", hostId: "h1" }, ALL],
    [
      "a muted host gets nothing: no OS, no bell, no sound",
      prefs({ mutedHosts: ["h1"] }),
      { event: "needs-you", hostId: "h1", session: "h1/s" },
      NONE,
    ],
    [
      "another host is not muted",
      prefs({ mutedHosts: ["h1"] }),
      { event: "needs-you", hostId: "h2" },
      ALL,
    ],
    [
      "a muted project gets nothing",
      prefs({ mutedProjects: ["h1/p-api"] }),
      { event: "turn-finished", hostId: "h1", project: "h1/p-api" },
      NONE,
    ],
    [
      "a muted session gets nothing",
      prefs({ mutedSessions: ["h1/s"] }),
      { event: "needs-you", hostId: "h1", session: "h1/s" },
      NONE,
    ],
    [
      "a snoozed session gets nothing until the snooze ends",
      prefs({ snoozed: { "h1/s": NOW + 1000 } }),
      { event: "needs-you", session: "h1/s" },
      NONE,
    ],
    [
      "a snooze that has ended no longer silences",
      prefs({ snoozed: { "h1/s": NOW - 1 } }),
      { event: "needs-you", session: "h1/s" },
      ALL,
    ],
    [
      "an event that is off gets nothing",
      prefs({ events: { ...DEFAULT_NOTIFY_PREFS.events, "turn-finished": false } }),
      { event: "turn-finished" },
      NONE,
    ],
    [
      "the other events stay on when one is off",
      prefs({ events: { ...DEFAULT_NOTIFY_PREFS.events, "turn-finished": false } }),
      { event: "needs-you" },
      ALL,
    ],
    [
      "the master switch off keeps the bell entry and drops the OS notification and the sound",
      prefs({ enabled: false }),
      { event: "needs-you" },
      { os: false, bell: true, sound: false, fold: false },
    ],
    [
      "what has no switch (a security warning) follows the master only",
      prefs({
        events: Object.fromEntries(
          Object.keys(DEFAULT_NOTIFY_PREFS.events).map((k) => [k, false]),
        ) as NotifyPrefs["events"],
      }),
      { event: "other" },
      ALL,
    ],
    [
      "a worker's finished turn waits to be folded into its team's message",
      prefs(),
      { event: "turn-finished", worker: true },
      { os: true, bell: true, sound: true, fold: true },
    ],
    [
      "a worker's permission request is its own notification",
      prefs(),
      { event: "needs-you", worker: true },
      ALL,
    ],
    [
      "with team folding off a worker is like any other session",
      prefs({ teamFold: false }),
      { event: "turn-finished", worker: true },
      ALL,
    ],
    [
      "a muted worker is not folded either",
      prefs({ mutedSessions: ["h1/w"] }),
      { event: "turn-finished", worker: true, session: "h1/w" },
      NONE,
    ],
  ];
  for (const [name, p, source, expected] of cases) {
    test(name, () => expect(decide(p, source, NOW)).toEqual(expected));
  }
});

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    } as unknown as Platform["storage"],
    data,
  };
};
const KEY = "flightdeck.notifyPrefs";

describe("notify-prefs: kept per computer (issue #149)", () => {
  test("the defaults when nothing is stored, and when what is stored is not usable", () => {
    expect(new NotifyPreferences(memory().storage).value).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(new NotifyPreferences(memory({ [KEY]: "{not json" }).storage).value).toEqual(
      DEFAULT_NOTIFY_PREFS,
    );
    expect(new NotifyPreferences(memory({ [KEY]: "[1,2]" }).storage).value).toEqual(
      DEFAULT_NOTIFY_PREFS,
    );
  });

  test("every switch and mute is saved and comes back after a restart", () => {
    const kept = memory();
    const p = new NotifyPreferences(kept.storage);
    p.setEnabled(false);
    p.setEvent("turn-finished", false);
    p.setTeamFold(false);
    p.setSound({ mode: "system", volume: 0.8 });
    p.muteHost("h1", true);
    p.muteProject("h1/p-api", true);
    p.muteSession("h1/s", true);
    p.snooze("h2/s", NOW + 3_600_000, NOW);
    const again = new NotifyPreferences(kept.storage).value;
    expect(again).toMatchObject({
      enabled: false,
      teamFold: false,
      mutedHosts: ["h1"],
      mutedProjects: ["h1/p-api"],
      mutedSessions: ["h1/s"],
      snoozed: { "h2/s": NOW + 3_600_000 },
      sound: { mode: "system", volume: 0.8 },
    });
    expect(again.events["turn-finished"]).toBe(false);
    expect(again.events["needs-you"]).toBe(true);
  });

  test("unmuting removes the entry, and muting twice keeps one", () => {
    const p = new NotifyPreferences(memory().storage);
    p.muteHost("h1", true);
    p.muteHost("h1", true);
    expect(p.value.mutedHosts).toEqual(["h1"]);
    p.muteHost("h1", false);
    expect(p.value.mutedHosts).toEqual([]);
    p.muteProject("a/b", true);
    p.muteProject("a/b", false);
    p.muteSession("a/s", true);
    p.muteSession("a/s", false);
    expect(p.value.mutedProjects).toEqual([]);
    expect(p.value.mutedSessions).toEqual([]);
  });

  test("a session is quiet while muted or snoozed; a snooze in the past lifts itself", () => {
    const p = new NotifyPreferences(memory().storage);
    expect(p.isQuiet("h/s", NOW)).toBe(false);
    p.muteSession("h/s", true);
    expect(p.isQuiet("h/s", NOW)).toBe(true);
    p.muteSession("h/s", false);
    p.snooze("h/s", NOW + 1000, NOW);
    expect(p.isQuiet("h/s", NOW)).toBe(true);
    expect(p.isQuiet("h/s", NOW + 1000)).toBe(false);
    p.snooze("h/s", NOW - 1, NOW);
    expect(p.value.snoozed).toEqual({});
  });

  test("a chosen sound file is kept with its name, and cleared by choosing none", () => {
    const kept = memory();
    const p = new NotifyPreferences(kept.storage);
    expect(p.soundFile()).toBeNull();
    p.setSoundFile("ding.mp3", "data:audio/mpeg;base64,AAAA");
    expect(p.value.sound).toMatchObject({ mode: "file", fileName: "ding.mp3" });
    const again = new NotifyPreferences(kept.storage);
    expect(again.soundFile()).toBe("data:audio/mpeg;base64,AAAA");
    again.setSoundFile(null, null);
    expect(again.soundFile()).toBeNull();
    expect(again.value.sound.fileName).toBeNull();
  });

  test("a file that is too large to keep is refused, and the old sound stays", () => {
    const p = new NotifyPreferences(memory().storage);
    p.setSoundFile("ding.mp3", "data:audio/mpeg;base64,AAAA");
    expect(p.setSoundFile("big.wav", `data:audio/wav;base64,${"A".repeat(700_000)}`)).toBe(false);
    expect(p.value.sound.fileName).toBe("ding.mp3");
    expect(p.soundFile()).toBe("data:audio/mpeg;base64,AAAA");
  });

  test("changing tells the listeners, and the volume stays between 0 and 1", () => {
    const p = new NotifyPreferences(memory().storage);
    let told = 0;
    p.subscribe(() => told++);
    p.setSound({ volume: 3 });
    expect(p.value.sound.volume).toBe(1);
    p.setSound({ volume: -2 });
    expect(p.value.sound.volume).toBe(0);
    p.setEnabled(false);
    expect(told).toBe(3);
  });
});

describe("notify-prefs: the sound plays from the app (issue #149)", () => {
  function fakeAudio() {
    const made: Array<Record<string, unknown>> = [];
    const played: Array<{ url: string; volume: number }> = [];
    return {
      made,
      played,
      deps: {
        audioContext: () => ({
          currentTime: 0,
          destination: "out",
          createGain: () => {
            const gain = { gain: { value: 1 }, connect: () => {} };
            made.push({ gain });
            return gain;
          },
          createOscillator: () => {
            const osc = {
              frequency: { value: 0 },
              connect: () => {},
              start: () => void made.push({ started: true }),
              stop: () => {},
            };
            made.push({ osc });
            return osc;
          },
        }),
        audio: (url: string) => {
          const el = { volume: 1, play: () => void played.push({ url, volume: el.volume }) };
          return el;
        },
      },
    };
  }

  test("off plays nothing", () => {
    const f = fakeAudio();
    playNotifySound({ mode: "off", volume: 1, fileName: null }, null, f.deps);
    expect(f.made).toEqual([]);
    expect(f.played).toEqual([]);
  });

  test("the system sound is a short tone at the chosen volume", () => {
    const f = fakeAudio();
    playNotifySound({ mode: "system", volume: 0.25, fileName: null }, null, f.deps);
    const gain = f.made.find((m) => m.gain)?.gain as { gain: { value: number } };
    expect(gain.gain.value).toBe(0.25);
    expect(f.made.some((m) => m.started)).toBe(true);
  });

  test("a chosen file plays at the chosen volume; with no file saved it falls back to the tone", () => {
    const f = fakeAudio();
    playNotifySound(
      { mode: "file", volume: 0.4, fileName: "ding.mp3" },
      "data:audio/mpeg;base64,AA",
      f.deps,
    );
    expect(f.played).toEqual([{ url: "data:audio/mpeg;base64,AA", volume: 0.4 }]);
    const g = fakeAudio();
    playNotifySound({ mode: "file", volume: 0.4, fileName: null }, null, g.deps);
    expect(g.played).toEqual([]);
    expect(g.made.some((m) => m.started)).toBe(true);
  });

  test("a browser without audio, or one that refuses to play, never throws", () => {
    expect(() =>
      playNotifySound({ mode: "system", volume: 1, fileName: null }, null, {}),
    ).not.toThrow();
    expect(() =>
      playNotifySound({ mode: "file", volume: 1, fileName: "a" }, "data:x", {
        audio: () => ({
          volume: 1,
          play: () => {
            throw new Error("blocked");
          },
        }),
      }),
    ).not.toThrow();
    expect(() =>
      playNotifySound({ mode: "file", volume: 1, fileName: "a" }, "data:x", {
        audio: () => ({ volume: 1, play: () => Promise.reject(new Error("blocked")) }),
      }),
    ).not.toThrow();
  });
});

describe("notify-prefs: mark as unread (issue #149, shared with #137)", () => {
  const entry = (id: string, read: boolean): InboxEntry => ({
    id,
    at: "2026-11-04T10:00:00.000Z",
    title: id,
    body: "",
    read,
  });

  test("an entry that was read becomes unread again, and the others stay", () => {
    const list = [entry("a", true), entry("b", true), entry("c", false)];
    const out = markUnread(list, "a");
    expect(out.map((e) => e.read)).toEqual([false, true, false]);
    expect(unreadCount(out)).toBe(2);
  });
});
