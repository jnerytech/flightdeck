import { describe, expect, test } from "bun:test";
import type { TeamInfo } from "@flightdeck/protocol";
import { AppStore, needsYou } from "../src/lib/app-store.ts";
import { memoryPlatform } from "./fixtures.ts";

const T0 = Date.parse("2026-11-04T10:00:00.000Z");

/** A store with one host, a project at /work/api, a clock and timers the test drives. */
function world(language: "en" | "pt-BR" = "en") {
  const mem = memoryPlatform(false, language);
  const clock = { now: T0 };
  const queue: Array<() => void> = [];
  const timers = {
    setTimeout: (fn: () => void) => queue.push(fn),
    clearTimeout: () => {},
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000, now: () => clock.now, timers });
  store.i18n.start();
  const internals = store as unknown as {
    update(patch: object): void;
    onSummary(hostId: string, summary: object): void;
  };
  internals.update({
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "offline",
        info: null,
        hostInfo: null,
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main" }] },
  });
  const summary = (id: string, status: string, pending: string[] = [], cwd = "/work/api") =>
    internals.onSummary("h1", {
      type: "session.summary",
      sessionId: id,
      name: `sessao-${id}`,
      cwd,
      status,
      pendingPermissions: pending.map((requestId) => ({
        requestId,
        toolName: "Bash",
        input: {},
        createdAt: "2026-11-04T10:00:00Z",
      })),
      updatedAt: "2026-11-04T10:00:00Z",
    });
  const titles = () => mem.notifications.map((n) => n.title);
  const flush = () => {
    for (const fn of queue.splice(0)) fn();
  };
  return { store, mem, clock, summary, titles, flush };
}

/** The session starts a turn, then finishes it. */
const finishTurn = (w: ReturnType<typeof world>, id: string) => {
  w.summary(id, "running");
  w.summary(id, "idle");
};

describe("notify-prefs-store: the preferences decide what is sent (issue #149)", () => {
  test("by default a request and a finished turn notify, and both reach the bell", () => {
    const w = world();
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    w.summary("s", "idle");
    expect(w.titles()).toEqual(["alfa · sessao-s: needs you", "alfa · sessao-s: turn finished"]);
    expect(w.store.getState().inbox).toHaveLength(2);
  });

  test("a muted host: no OS notification and no bell entry, but the request is still in Needs you", () => {
    const w = world();
    w.store.notifyPrefs.muteHost("h1", true);
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    expect(w.titles()).toEqual([]);
    expect(w.store.getState().inbox).toEqual([]);
    expect(needsYou(w.store.getState())).toHaveLength(1);
  });

  test("a muted project and a muted session are quiet; a session of another project is not", () => {
    const w = world();
    w.store.notifyPrefs.muteProject("h1/p-api", true);
    w.summary("a", "idle");
    w.summary("a", "running", ["r1"]);
    expect(w.titles()).toEqual([]);
    w.summary("b", "idle", [], "/elsewhere");
    w.summary("b", "running", ["r2"], "/elsewhere");
    expect(w.titles()).toHaveLength(1);
    const x = world();
    x.store.notifyPrefs.muteSession("h1/c", true);
    x.summary("c", "idle");
    x.summary("c", "running", ["r1"]);
    expect(x.titles()).toEqual([]);
  });

  test("a snooze silences for the hour and then the session speaks again", () => {
    const w = world();
    w.store.notifyPrefs.snooze("h1/s", T0 + 3_600_000, T0);
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    expect(w.titles()).toEqual([]);
    w.clock.now = T0 + 3_600_001;
    w.summary("s", "running", ["r1", "r2"]);
    expect(w.titles()).toHaveLength(1);
  });

  test("turning an event off silences that event only", () => {
    const w = world();
    w.store.notifyPrefs.setEvent("turn-finished", false);
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    w.summary("s", "idle");
    expect(w.titles()).toEqual(["alfa · sessao-s: needs you"]);
  });

  test("the master switch off keeps the bell and drops the OS notification", () => {
    const w = world();
    w.store.notifyPrefs.setEnabled(false);
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    expect(w.titles()).toEqual([]);
    expect(w.store.getState().inbox).toHaveLength(1);
  });

  test("the sound plays once for each notification that is sent, and not for a muted one", () => {
    const w = world();
    let plays = 0;
    w.store.soundPlayer = () => void plays++;
    w.store.notifyPrefs.setSound({ mode: "system" });
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    expect(plays).toBe(1);
    w.store.notifyPrefs.muteHost("h1", true);
    w.summary("s", "running", ["r1", "r2"]);
    expect(plays).toBe(1);
    w.store.notifyPrefs.muteHost("h1", false);
    w.store.notifyPrefs.setSound({ mode: "off" });
    w.summary("s", "running", ["r1", "r2", "r3"]);
    expect(plays).toBe(1);
  });
});

describe("notify-prefs-store: a session that failed (issue #149)", () => {
  test("a turn that ends in an error says so, and the switch silences it", () => {
    const w = world();
    w.summary("s", "idle");
    w.summary("s", "running");
    w.summary("s", "error");
    expect(w.titles()).toEqual(["alfa · sessao-s: failed"]);
    const x = world();
    x.store.notifyPrefs.setEvent("session-failed", false);
    x.summary("s", "idle");
    x.summary("s", "running");
    x.summary("s", "error");
    expect(x.titles()).toEqual([]);
  });
});

const team = (workers: string[]): TeamInfo =>
  ({
    id: "t1",
    name: "Alpha",
    projectId: "p-api",
    goal: "g",
    coordinator: "lead",
    members: [
      { name: "lead", role: "coordinator", sessionId: "lead" },
      ...workers.map((id) => ({ name: `w-${id}`, role: "worker", sessionId: id })),
    ],
    checks: [],
    state: "active",
    pausedBy: null,
    instructionsVersion: "1",
    createdAt: "2026-11-04T09:00:00Z",
  }) as unknown as TeamInfo;

describe("notify-prefs-store: a team's workers are folded into one message (issue #149)", () => {
  test("three workers finishing together send one folded notification", () => {
    const w = world();
    w.store.rememberTeam("h1", team(["w1", "w2", "w3"]));
    for (const id of ["w1", "w2", "w3"]) w.summary(id, "idle");
    for (const id of ["w1", "w2", "w3"]) finishTurn(w, id);
    expect(w.titles()).toEqual([]);
    w.flush();
    expect(w.titles()).toEqual(["Team Alpha: 3 workers finished"]);
    expect(w.store.getState().inbox).toHaveLength(1);
  });

  test("one worker alone is told as itself once the window ends", () => {
    const w = world();
    w.store.rememberTeam("h1", team(["w1", "w2"]));
    w.summary("w1", "idle");
    finishTurn(w, "w1");
    w.flush();
    expect(w.titles()).toEqual(["alfa · sessao-w1: turn finished"]);
  });

  test("a worker's permission request notifies at once, and the coordinator is a session like any other", () => {
    const w = world();
    w.store.rememberTeam("h1", team(["w1"]));
    w.summary("w1", "idle");
    w.summary("w1", "running", ["r1"]);
    expect(w.titles()).toEqual(["alfa · sessao-w1: needs you"]);
    w.summary("lead", "idle");
    finishTurn(w, "lead");
    expect(w.titles()).toContain("alfa · sessao-lead: turn finished");
  });

  test("with folding off each worker notifies on its own", () => {
    const w = world();
    w.store.notifyPrefs.setTeamFold(false);
    w.store.rememberTeam("h1", team(["w1", "w2"]));
    for (const id of ["w1", "w2"]) {
      w.summary(id, "idle");
      finishTurn(w, id);
    }
    expect(w.titles()).toHaveLength(2);
  });

  test("a muted worker is left out of the count", () => {
    const w = world();
    w.store.notifyPrefs.muteSession("h1/w2", true);
    w.store.rememberTeam("h1", team(["w1", "w2", "w3"]));
    for (const id of ["w1", "w2", "w3"]) w.summary(id, "idle");
    for (const id of ["w1", "w2", "w3"]) finishTurn(w, id);
    w.flush();
    expect(w.titles()).toEqual(["Team Alpha: 2 workers finished"]);
  });

  test("a closed team stops folding: its sessions are plain ones again", () => {
    const w = world();
    w.store.rememberTeam("h1", { ...team(["w1"]), state: "closed" });
    w.summary("w1", "idle");
    finishTurn(w, "w1");
    expect(w.titles()).toEqual(["alfa · sessao-w1: turn finished"]);
  });
});

describe("notify-prefs-store: the test notification (issue #149)", () => {
  test("delivered when the system shows it", async () => {
    const w = world();
    expect(await w.store.sendTestNotification()).toBe("delivered");
    expect(w.titles()).toEqual(["Test notification"]);
  });

  test("blocked when it does not, and nothing shows", async () => {
    const w = world();
    const api = w.mem.win.Notification as unknown as {
      permission: string;
      requestPermission: () => Promise<string>;
    };
    api.permission = "denied";
    api.requestPermission = async () => "denied";
    expect(await w.store.sendTestNotification()).toBe("blocked");
    expect(w.titles()).toEqual([]);
  });

  test("the platform says whether it showed, and the test does not touch the bell", async () => {
    const w = world();
    expect(await w.mem.platform.notify({ title: "a", body: "b" })).toBe(true);
    expect(w.store.getState().inbox).toEqual([]);
    (w.mem.win as { Notification?: unknown }).Notification = undefined;
    expect(await w.mem.platform.notify({ title: "a", body: "b" })).toBe(false);
  });
});

describe("notify-prefs-store: mark as unread (issue #149, shared with #137)", () => {
  test("a read entry can be marked unread again, one or several", () => {
    const w = world();
    w.summary("s", "idle");
    w.summary("s", "running", ["r1"]);
    w.summary("s", "idle");
    const ids = w.store.getState().inbox.map((e) => e.id);
    w.store.inboxMarkAllRead();
    expect(w.store.getState().inbox.every((e) => e.read)).toBe(true);
    w.store.inboxMarkUnread(ids[0] as string);
    expect(w.store.getState().inbox.filter((e) => !e.read)).toHaveLength(1);
    w.store.inboxMarkUnread(ids);
    expect(w.store.getState().inbox.every((e) => !e.read)).toBe(true);
  });
});
