import { describe, expect, test } from "bun:test";
import {
  capGroups,
  DEFAULT_HUB_FILTER,
  type HubGroup,
  type HubRow,
  hubGroups,
  hubView,
  isSearching,
} from "../src/lib/hub.ts";

const row = (n: number, over: Partial<HubRow> = {}): HubRow => ({
  key: `h/${n}`,
  hostId: "h",
  hostName: "alfa",
  origin: "terminal",
  claudeSessionId: `c${n}`,
  sessionId: null,
  title: `sessão ${n}`,
  cwd: "/work/api",
  projectKey: "host:alfa:/work/api",
  state: "idle",
  controllable: false,
  lastActivity: `2026-11-03T10:0${n}:00.000Z`,
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...over,
});

const group = (key: string, rows: number): HubGroup =>
  ({
    key,
    foldKey: key,
    name: key,
    rows: Array.from({ length: rows }, (_, i) => row(i + 1, { projectKey: key })),
  }) as HubGroup;

describe("sessoes-dobra: the cap keeps the headers of folded projects (issue #241)", () => {
  test("projects folded to nothing after a full one keep their headers, and nothing is hidden", () => {
    const out = capGroups([group("a", 3), group("b", 0), group("c", 0)], 3);
    expect(out.groups.map((g) => g.key)).toEqual(["a", "b", "c"]);
    expect(out.hidden).toBe(0);
  });

  test("a project cut by the cap still shows the folded ones after it, and the hidden rows are counted", () => {
    const out = capGroups([group("a", 5), group("b", 0)], 3);
    expect(out.groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["a", 3],
      ["b", 0],
    ]);
    expect(out.hidden).toBe(2);
  });

  test("a project with rows that comes after the cap is left out and counted", () => {
    const out = capGroups([group("a", 3), group("b", 0), group("c", 2)], 3);
    expect(out.groups.map((g) => g.key)).toEqual(["a", "b"]);
    expect(out.hidden).toBe(2);
  });

  test("under the cap everything is kept as it was", () => {
    const groups = [group("a", 1), group("b", 0), group("c", 2)];
    const out = capGroups(groups, 200);
    expect(out.groups).toEqual(groups);
    expect(out.hidden).toBe(0);
  });
});

describe("sessoes-dobra: a Hosts chip narrows the list without unfolding it (issue #241)", () => {
  test("text, origin, state, persona and pinned open what they keep; the host and archived do not", () => {
    expect(isSearching(DEFAULT_HUB_FILTER)).toBe(false);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, text: "x" })).toBe(true);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, text: "   " })).toBe(false);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, origin: "history" })).toBe(true);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, state: "idle" })).toBe(true);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, persona: "dev" })).toBe(true);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, pinnedOnly: true })).toBe(true);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, host: "alfa" })).toBe(false);
    expect(isSearching({ ...DEFAULT_HUB_FILTER, showArchived: true })).toBe(false);
  });
});

describe("sessoes-dobra: the fold state keeps its key when hosts come and go (issue #241)", () => {
  const alfa = (n: number) =>
    row(n, { hostName: "alfa", cwd: "/home/a/api", projectKey: "host:alfa:/home/a/api" });
  const beta = (n: number) =>
    row(n, { hostId: "b", hostName: "beta", cwd: "/srv/api", projectKey: "host:beta:/srv/api" });

  test("a project on two hosts folds under one key, the same with only one of them there", () => {
    const both = hubGroups([alfa(1), beta(2)], DEFAULT_HUB_FILTER)[0];
    const onlyBeta = hubGroups([beta(2)], DEFAULT_HUB_FILTER)[0];
    const onlyAlfa = hubGroups([alfa(1)], DEFAULT_HUB_FILTER)[0];
    expect(both?.foldKey).toBe("folder:api");
    expect(onlyBeta?.foldKey).toBe("folder:api");
    expect(onlyAlfa?.foldKey).toBe("folder:api");
    // The group's own key still names a real project, for the client scope.
    expect(both?.key).toBe("host:alfa:/home/a/api");
    expect(onlyBeta?.key).toBe("host:beta:/srv/api");
  });

  test("a project the daemon resolved folds under its own key", () => {
    const resolved = row(1, { projectKey: "github.com/acme/api" });
    expect(hubGroups([resolved], DEFAULT_HUB_FILTER)[0]?.foldKey).toBe("github.com/acme/api");
  });

  test("two folders of one name on a host fold apart, each under its own key", () => {
    const one = row(1, { cwd: "/a/api", projectKey: "host:alfa:/a/api" });
    const two = row(2, { cwd: "/b/api", projectKey: "host:alfa:/b/api" });
    const keys = hubGroups([one, two], DEFAULT_HUB_FILTER).map((g) => g.foldKey);
    expect(new Set(keys)).toEqual(new Set(["host:alfa:/a/api", "host:alfa:/b/api"]));
  });

  test("the view opens and folds by that key; a choice made under the old key still counts until a new one is made", () => {
    const groups = hubGroups([alfa(1)], DEFAULT_HUB_FILTER);
    const view = (open: Record<string, boolean | undefined>) =>
      hubView(groups, open, {}, false)[0]?.expanded;
    expect(view({})).toBe(false);
    expect(view({ "folder:api": true })).toBe(true);
    // Kept before the key was stable: the project's old key.
    expect(view({ "host:alfa:/home/a/api": true })).toBe(true);
    // A choice under the new key wins over the old one.
    expect(view({ "folder:api": false, "host:alfa:/home/a/api": true })).toBe(false);
  });

  test("the earlier-sessions fold follows the same key", () => {
    const groups = hubGroups(
      [alfa(1), alfa(2), { ...alfa(3), origin: "history", state: "ended" }],
      DEFAULT_HUB_FILTER,
    );
    const shown = (earlier: Record<string, boolean | undefined>) =>
      hubView(groups, { "folder:api": true }, earlier, false)[0]?.earlierShown;
    expect(shown({})).toBe(false);
    expect(shown({ "folder:api": true })).toBe(true);
  });
});
