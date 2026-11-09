import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { AppStore } from "../src/lib/app-store.ts";
import { type HubRowState, hubRows } from "../src/lib/hub.ts";
import { type QuietState, quietAlerts, quietText } from "../src/lib/quiet.ts";
import { memoryPlatform } from "./fixtures.ts";

const NOW = Date.parse("2026-11-09T12:30:00.000Z");
const MIN = 60_000;
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN).toISOString();

const managed = (id: string, over: object = {}) => ({
  id,
  name: `session ${id}`,
  claudeSessionId: `c-${id}`,
  cwd: `/w/${id}`,
  status: "running",
  updatedAt: at(40),
  ...over,
});
const live = (id: string, over: object = {}) => ({
  id,
  name: `session ${id}`,
  cwd: `/w/${id}`,
  status: "running",
  pendingPermissions: [],
  updatedAt: at(40),
  ...over,
});

/** A host `h` with these sessions, as the app holds them: the list and the live summaries. */
function state(
  sessions: Array<{ managed: object; live?: object }>,
  quietSnooze: Record<string, number> = {},
): QuietState & HubRowState {
  return {
    hosts: [{ id: "h", name: "alfa", sessions: sessions.flatMap((s) => (s.live ? [s.live] : [])) }],
    hub: { h: { managed: sessions.map((s) => s.managed), history: [] } },
    meta: {},
    externals: {},
    names: {},
    background: {},
    quietSnooze,
  } as never;
}

describe("stall-state: the app learns which sessions are quiet (issue #1478)", () => {
  test("a live summary's quietSince and last tool reach the hub row; the list's own copy is the fallback", () => {
    const rows = hubRows(
      state([
        { managed: managed("s1"), live: live("s1", { quietSince: at(25), quietTool: "Bash" }) },
        { managed: managed("s2", { quietSince: at(30), quietTool: null }) },
        // The live summary is newer than the list: it says the session moved, so it is not quiet.
        { managed: managed("s3", { quietSince: at(30) }), live: live("s3") },
      ]),
    );
    const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
    expect([by.s1?.quietSince, by.s1?.quietTool]).toEqual([at(25), "Bash"]);
    expect([by.s2?.quietSince, by.s2?.quietTool]).toEqual([at(30), null]);
    expect(by.s3?.quietSince).toBeUndefined();
  });

  test("a summary from the host sets quietSince and quietTool on the session, and the next one clears them", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { now: () => NOW });
    const inner = store as unknown as {
      update(p: object): void;
      onSummaries(hostId: string, summaries: object[]): void;
    };
    inner.update({ hosts: [{ id: "h", name: "alfa", status: "online", sessions: [] }] });
    const summary = (over: object = {}) => ({
      type: "session.summary",
      sessionId: "s1",
      name: null,
      cwd: "/w",
      status: "running",
      pendingPermissions: [],
      updatedAt: at(1),
      ...over,
    });
    inner.onSummaries("h", [summary({ quietSince: at(20), quietTool: "Bash" })]);
    const first = store.getState().hosts[0]?.sessions[0];
    expect([first?.quietSince, first?.quietTool]).toEqual([at(20), "Bash"]);
    inner.onSummaries("h", [summary()]);
    const next = store.getState().hosts[0]?.sessions[0];
    // The session is still listed: an absent one would pass the two checks below by itself.
    expect(next?.id).toBe("s1");
    expect(next?.quietSince).toBeUndefined();
    expect(next?.quietTool).toBeUndefined();
  });
});

describe("stall-state: the quiet sessions Needs you lists", () => {
  test("only a running session of the app with quietSince, the longest quiet first", () => {
    const alerts = quietAlerts(
      state([
        { managed: managed("s1"), live: live("s1", { quietSince: at(25), quietTool: "Bash" }) },
        { managed: managed("s2"), live: live("s2", { quietSince: at(50), quietTool: null }) },
        { managed: managed("s3"), live: live("s3") },
        {
          managed: managed("s4", { status: "idle" }),
          live: live("s4", { status: "idle", quietSince: at(60) }),
        },
      ]),
      NOW,
    );
    expect(alerts.map((a) => [a.key, a.hostName, a.since, a.tool])).toEqual([
      ["h/s2", "alfa", at(50), null],
      ["h/s1", "alfa", at(25), "Bash"],
    ]);
    expect(alerts[1]?.title).toBe("session s1");
  });

  test("a snoozed session is left out until the hour is up", () => {
    const sessions = [
      { managed: managed("s1"), live: live("s1", { quietSince: at(25), quietTool: "Bash" }) },
    ];
    const snoozed = { "h/s1": NOW + 10 * MIN };
    expect(quietAlerts(state(sessions, snoozed), NOW)).toHaveLength(0);
    expect(quietAlerts(state(sessions, snoozed), NOW + 10 * MIN)).toHaveLength(1);
    expect(quietAlerts(state(sessions, {}), NOW)).toHaveLength(1);
  });

  test("the row says how long and with which tool, in both languages", () => {
    const alert = {
      key: "h/s1",
      hostId: "h",
      hostName: "alfa",
      sessionId: "s1",
      title: "api",
      since: at(23),
      tool: "Bash",
    };
    const en = translator("en");
    const pt = translator("pt-BR");
    expect(quietText(alert, NOW, en)).toBe("Quiet for 23 min · last: Bash");
    expect(quietText({ ...alert, tool: null }, NOW, en)).toBe("Quiet for 23 min");
    expect(quietText({ ...alert, since: at(65) }, NOW, en)).toBe(
      "Quiet for 1 h 5 min · last: Bash",
    );
    expect(quietText(alert, NOW, pt)).toBe("Em silêncio há 23 min · última: Bash");
    expect(quietText({ ...alert, tool: null }, NOW, pt)).toBe("Em silêncio há 23 min");
  });
});

describe("stall-state: the quiet sessions come from the live summaries (issue #1478)", () => {
  test("a quiet session is listed before the host's session list was ever fetched, with its meta name", () => {
    const base = state([
      { managed: managed("s1"), live: live("s1", { quietSince: at(25), quietTool: "Bash" }) },
      { managed: managed("s2"), live: live("s2", { quietSince: at(30), name: "api" }) },
    ]) as unknown as { hub: object; meta: object };
    base.hub = {};
    base.meta = { "h/s2": { name: "Renamed by hand" } };
    const alerts = quietAlerts(base as never, NOW);
    expect(alerts.map((a) => [a.key, a.title, a.since, a.tool])).toEqual([
      ["h/s2", "Renamed by hand", at(30), null],
      ["h/s1", "session s1", at(25), "Bash"],
    ]);
  });
});

describe("stall-state: Not stuck, and the ways on", () => {
  test("Not stuck hides the session for an hour, only that session", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { now: () => NOW });
    store.snoozeQuiet("h", "s1");
    expect(store.getState().quietSnooze).toEqual({ "h/s1": NOW + 60 * 60_000 });
    store.snoozeQuiet("h", "s2");
    expect(Object.keys(store.getState().quietSnooze).sort((a, b) => a.localeCompare(b))).toEqual([
      "h/s1",
      "h/s2",
    ]);
  });

  test("Interrupt asks the host to interrupt that session, open or not", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { now: () => NOW });
    const sent: Array<[string, unknown]> = [];
    (
      store as unknown as {
        connections: Map<string, { request(type: string, payload: unknown): Promise<unknown> }>;
      }
    ).connections.set("h", {
      request: async (type, payload) => {
        sent.push([type, payload]);
        return {};
      },
    });
    await store.interruptSession("h", "s1");
    expect(sent).toEqual([["session.interrupt", { sessionId: "s1" }]]);
  });
});
