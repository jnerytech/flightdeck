import { describe, expect, test } from "bun:test";
import type { SessionEventOf, TeamInfo } from "@flightdeck/protocol";
import { NotifyPreferences } from "../../src/features/notifications/index.ts";
import { SummariesSlice } from "../../src/features/sessions/index.ts";
import { translator } from "../../src/i18n/index.ts";
import type { SidebarSession } from "../../src/lib/app-store.ts";

const t = translator("en");

type Summary = SessionEventOf<"session.summary">;

const summary = (id: string, status: string, requests: string[] = [], cwd = "/work/api"): Summary =>
  ({
    sessionId: id,
    name: `name-${id}`,
    cwd,
    status,
    updatedAt: "2026-11-11T10:00:00Z",
    pendingPermissions: requests.map((requestId) => ({
      requestId,
      toolName: "Bash",
      createdAt: "2026-11-11T10:00:00Z",
    })),
  }) as unknown as Summary;

const team = (workers: string[], state = "active") =>
  ({
    id: "t1",
    name: "Alpha",
    state,
    members: workers.map((id) => ({ name: id, role: "worker", sessionId: id })),
  }) as unknown as TeamInfo;

/** A slice over stand-ins: the host's sessions, what the store was told, and the timers by hand. */
function summaries(over: { focused?: boolean; shown?: string[]; fold?: boolean } = {}) {
  const log: unknown[] = [];
  const hosts = [{ id: "h1", name: "alfa", sessions: [] as SidebarSession[] }];
  const timers: Array<() => void> = [];
  const store = new Map<string, string>();
  const prefs = new NotifyPreferences({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  });
  if (over.fold === false) prefs.setTeamFold(false);
  const slice = new SummariesSlice({
    hosts: () => hosts,
    markUnread: (keys) => void log.push({ unread: keys }),
    setSessions: (hostId, sessions) => {
      const host = hosts.find((h) => h.id === hostId);
      if (host) host.sessions = sessions;
      log.push({ sessions: sessions.map((s) => `${s.id}:${s.status}`) });
    },
    shown: () => new Set(over.shown ?? []),
    projectOf: (_hostId, cwd) => (cwd?.startsWith("/work/api") ? "h1/p-api" : undefined),
    isSimple: () => false,
    isFocused: () => over.focused ?? false,
    prefs: () => prefs.value,
    now: () => Date.parse("2026-11-11T10:00:00Z"),
    t: () => t,
    notify: (n, route, _fallback, source) =>
      void log.push({ notify: n.title, route, source: source && { ...source } }),
    feed: (host, prev, next) => void log.push({ feed: [host.name, prev?.status, next.status] }),
    finished: (hostId, prev, next) =>
      void log.push({ finished: [hostId, prev?.status, next.status] }),
    later: (fn) => void timers.push(fn),
  });
  return {
    slice,
    log,
    hosts,
    flush: () => timers.splice(0).forEach((fn) => void fn()),
    titles: () =>
      log.flatMap((entry) =>
        typeof entry === "object" && entry && "notify" in entry ? [String(entry.notify)] : [],
      ),
  };
}

describe("session summaries (#1596)", () => {
  test("a summary adds its session and a later one replaces it in place, in one change per call", () => {
    const { slice, log, hosts } = summaries();
    slice.apply("h1", [summary("s1", "idle"), summary("s2", "idle")]);
    slice.apply("h1", [summary("s2", "running"), summary("s3", "idle")]);
    expect(hosts[0]?.sessions.map((s) => `${s.id}:${s.status}`)).toEqual([
      "s1:idle",
      "s2:running",
      "s3:idle",
    ]);
    expect(
      log.filter((entry) => typeof entry === "object" && entry && "sessions" in entry),
    ).toHaveLength(2);
  });

  test("a host that is gone, or no summaries, change nothing", () => {
    const { slice, log } = summaries();
    slice.apply("nope", [summary("s1", "idle")]);
    slice.apply("h1", []);
    expect(log).toEqual([]);
  });

  test("each change goes to the webhooks and to Needs you with what the session was before", () => {
    const { slice, log } = summaries();
    slice.apply("h1", [summary("s1", "running")]);
    slice.apply("h1", [summary("s1", "idle")]);
    expect(
      log.filter((e) => typeof e === "object" && e && ("feed" in e || "finished" in e)),
    ).toEqual([
      { feed: ["alfa", undefined, "running"] },
      { finished: ["h1", undefined, "running"] },
      { feed: ["alfa", "running", "idle"] },
      { finished: ["h1", "running", "idle"] },
    ]);
  });

  test("a reply to a session that is not on screen marks it unread; one on screen does not", () => {
    const off = summaries();
    off.slice.apply("h1", [summary("s1", "running"), summary("s2", "running")]);
    off.slice.apply("h1", [summary("s1", "idle"), summary("s2", "idle")]);
    expect(off.log.filter((e) => typeof e === "object" && e && "unread" in e)).toEqual([
      { unread: ["h1/s1", "h1/s2"] },
    ]);
    const on = summaries({ shown: ["h1/s1"] });
    on.slice.apply("h1", [summary("s1", "running")]);
    on.slice.apply("h1", [summary("s1", "idle")]);
    expect(on.log.some((e) => typeof e === "object" && e && "unread" in e)).toBe(false);
  });

  test("a new request is told with its link and opens its session at that request", () => {
    const { slice, log } = summaries();
    slice.apply("h1", [summary("s1", "running")]);
    slice.apply("h1", [summary("s1", "running", ["r1"])]);
    expect(log.find((e) => typeof e === "object" && e && "notify" in e)).toEqual({
      notify: t("notify.waiting", { label: "alfa · name-s1" }),
      route: { name: "session", host: "h1", id: "s1", focus: "r1" },
      source: { event: "needs-you", hostId: "h1", session: "h1/s1", project: "h1/p-api" },
    });
  });

  test("nothing is told while the window has the focus, nor for the first sight of a session", () => {
    const focused = summaries({ focused: true });
    focused.slice.apply("h1", [summary("s1", "running")]);
    focused.slice.apply("h1", [summary("s1", "running", ["r1"])]);
    expect(focused.titles()).toEqual([]);
    const first = summaries();
    first.slice.apply("h1", [summary("s1", "running", ["r1"])]);
    expect(first.titles()).toEqual([]);
  });

  test("three workers finishing together are told once, as their team, when the wait ends", () => {
    const { slice, titles, flush, log } = summaries();
    slice.rememberTeam("h1", team(["w1", "w2", "w3"]));
    for (const id of ["w1", "w2", "w3"]) slice.apply("h1", [summary(id, "running")]);
    for (const id of ["w1", "w2", "w3"]) slice.apply("h1", [summary(id, "idle")]);
    expect(titles()).toEqual([]);
    flush();
    expect(titles()).toEqual([t("notify.teamDone", { team: "Alpha", n: 3 })]);
    expect(log.at(-1)).toMatchObject({
      route: { name: "teams", host: "h1", team: "t1" },
      source: { event: "turn-finished", hostId: "h1", project: "h1/p-api" },
    });
  });

  test("one worker alone is told as itself, and with folding off each one is told at once", () => {
    const alone = summaries();
    alone.slice.rememberTeam("h1", team(["w1", "w2"]));
    alone.slice.apply("h1", [summary("w1", "running")]);
    alone.slice.apply("h1", [summary("w1", "idle")]);
    alone.flush();
    expect(alone.log.at(-1)).toMatchObject({
      notify: t("notify.turnDone", { label: "alfa · name-w1" }),
      source: { worker: false },
    });
    const off = summaries({ fold: false });
    off.slice.rememberTeam("h1", team(["w1", "w2"]));
    for (const id of ["w1", "w2"]) off.slice.apply("h1", [summary(id, "running")]);
    for (const id of ["w1", "w2"]) off.slice.apply("h1", [summary(id, "idle")]);
    expect(off.titles()).toHaveLength(2);
  });

  test("a closed team, or a team that changed its members, stops folding the ones it lost", () => {
    const { slice, titles, flush } = summaries();
    slice.rememberTeam("h1", team(["w1", "w2"]));
    slice.rememberTeam("h1", team(["w2"], "closed"));
    for (const id of ["w1", "w2"]) slice.apply("h1", [summary(id, "running")]);
    for (const id of ["w1", "w2"]) slice.apply("h1", [summary(id, "idle")]);
    flush();
    expect(titles()).toHaveLength(2);
  });
});
