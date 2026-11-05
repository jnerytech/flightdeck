import { describe, expect, test } from "bun:test";
import {
  DEFAULT_HUB_FILTER,
  type HubRow,
  hubGroups,
  hubView,
  loadHubOpen,
  saveHubOpen,
} from "../src/lib/hub.ts";

const row = (n: number, over: Partial<HubRow> = {}): HubRow => ({
  key: `h/${n}`,
  hostId: "h",
  hostName: "host",
  origin: "terminal",
  claudeSessionId: `c${n}`,
  sessionId: null,
  title: `sessão ${n}`,
  cwd: "/work/api",
  projectKey: "host:host:/work/api",
  state: "idle",
  controllable: false,
  lastActivity: `2026-11-03T10:0${n}:00.000Z`,
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...over,
});

const history = (n: number, over: Partial<HubRow> = {}) =>
  row(n, { origin: "history", state: "ended", ...over });

describe("sessoes-projetos: the filter reaches the project name (issue #111)", () => {
  test("typing a project's name keeps its sessions even when no title or folder says it", () => {
    const rows = [
      row(1, { cwd: "/srv/x", projectKey: "github.com/acme/billing" }),
      row(2, { cwd: "/srv/y", projectKey: "github.com/acme/search" }),
    ];
    const groups = hubGroups(rows, { ...DEFAULT_HUB_FILTER, text: "billing" });
    expect(groups.map((g) => g.name)).toEqual(["billing"]);
  });
});

describe("sessoes-projetos: every project starts folded, showing its needs-you rows (issue #111)", () => {
  const group = () =>
    hubGroups(
      [
        row(1, { state: "running" }),
        row(2, { state: "needs_you" }),
        history(3),
        history(4),
        row(5, { state: "ended" }),
      ],
      DEFAULT_HUB_FILTER,
    );

  test("folded by default: the header's numbers and only the rows that need you", () => {
    const [view] = hubView(group(), {}, {}, false);
    expect(view?.expanded).toBe(false);
    expect(view?.live.map((r) => r.key)).toEqual(["h/2", "h/1"]);
    expect(view?.earlier.map((r) => r.key)).toEqual(["h/5", "h/4", "h/3"]);
    expect([view?.live.length, view?.total]).toEqual([2, 5]);
    expect(view?.rows.map((r) => r.key)).toEqual(["h/2"]);
  });

  test("open: the live ones, newest first behind the count the earlier ones; folded again, the needs-you rows stay", () => {
    const key = group()[0]?.key as string;
    expect(hubView(group(), { [key]: true }, {}, false)[0]?.rows.map((r) => r.key)).toEqual([
      "h/2",
      "h/1",
    ]);
    expect(
      hubView(group(), { [key]: true }, { [key]: true }, false)[0]?.rows.map((r) => r.key),
    ).toEqual(["h/2", "h/1", "h/5", "h/4", "h/3"]);
    expect(
      hubView(group(), { [key]: false }, { [key]: true }, false)[0]?.rows.map((r) => r.key),
    ).toEqual(["h/2"]);
  });

  test("a project with nothing that needs you folds to just its header", () => {
    const only = hubGroups([row(1, { state: "running" }), history(2)], DEFAULT_HUB_FILTER);
    expect(hubView(only, {}, {}, false)[0]?.rows).toEqual([]);
  });

  test("a search or filter opens everything it keeps, unless the person folded that project", () => {
    const only = hubGroups([history(1), history(2)], DEFAULT_HUB_FILTER);
    const key = only[0]?.key as string;
    expect(hubView(only, {}, {}, true)[0]?.rows.map((r) => r.key)).toEqual(["h/2", "h/1"]);
    expect(hubView(only, { [key]: false }, {}, true)[0]?.rows).toEqual([]);
    expect(hubView(only, { [key]: true }, {}, false)[0]?.expanded).toBe(true);
  });

  test("a pinned session stays with the live ones, even an ended or history one", () => {
    const groups = hubGroups(
      [row(1, { state: "running" }), history(2, { pinned: true }), history(3)],
      DEFAULT_HUB_FILTER,
    );
    const [view] = hubView(groups, {}, {}, false);
    expect(view?.live.map((r) => r.key)).toEqual(["h/2", "h/1"]);
    expect(view?.earlier.map((r) => r.key)).toEqual(["h/3"]);
  });
});

describe("sessoes-projetos: the open or folded state is remembered per project (issue #111)", () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
  };

  test("what was chosen comes back; what was never chosen is left out", () => {
    const storage = memory();
    saveHubOpen(storage, {
      "github.com/acme/api": true,
      "host:a:/x": false,
      "host:a:/y": undefined,
    });
    expect(loadHubOpen(storage)).toEqual({ "github.com/acme/api": true, "host:a:/x": false });
  });

  test("nothing stored, text that is not JSON and values that are not booleans give none", () => {
    expect(loadHubOpen(memory())).toEqual({});
    expect(loadHubOpen({ getItem: () => "não é json" })).toEqual({});
    expect(loadHubOpen({ getItem: () => JSON.stringify({ a: "sim", b: true, c: 1 }) })).toEqual({
      b: true,
    });
    expect(loadHubOpen({ getItem: () => "[1,2]" })).toEqual({});
  });
});

describe("sessoes-projetos: one project on two hosts is one group (issue #111)", () => {
  const alfa = (n: number, over: Partial<HubRow> = {}) =>
    row(n, {
      hostId: "a",
      hostName: "alfa",
      cwd: "/home/a/api-gateway",
      projectKey: "host:alfa:/home/a/api-gateway",
      ...over,
    });
  const beta = (n: number, over: Partial<HubRow> = {}) =>
    row(n, {
      hostId: "b",
      hostName: "beta",
      cwd: "/srv/b/api-gateway",
      projectKey: "host:beta:/srv/b/api-gateway",
      ...over,
    });

  test("folder-keyed projects with the same name join across hosts, rows keep their host", () => {
    const groups = hubGroups(
      [alfa(1), beta(2), alfa(3, { cwd: "/home/a/docs", projectKey: "host:alfa:/home/a/docs" })],
      DEFAULT_HUB_FILTER,
    );
    expect(groups.map((g) => g.name).sort()).toEqual(["api-gateway", "docs"]);
    const joined = groups.find((g) => g.name === "api-gateway");
    expect(joined?.rows.map((r) => r.hostName).sort()).toEqual(["alfa", "beta"]);
  });

  test("the group key is the same whichever row is newest", () => {
    const one = hubGroups([alfa(1), beta(2)], DEFAULT_HUB_FILTER)[0]?.key;
    const other = hubGroups([alfa(2), beta(1)], DEFAULT_HUB_FILTER)[0]?.key;
    expect(one).toBe(other);
  });

  test("keys the daemon resolved (a remote) already agree and stay as they are", () => {
    const groups = hubGroups(
      [
        alfa(1, { projectKey: "github.com/acme/api" }),
        beta(2, { projectKey: "github.com/acme/api" }),
      ],
      DEFAULT_HUB_FILTER,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("github.com/acme/api");
  });

  test("a resolved remote and a folder of the same name stay apart", () => {
    const groups = hubGroups(
      [alfa(1, { projectKey: "github.com/acme/api-gateway" }), beta(2)],
      DEFAULT_HUB_FILTER,
    );
    expect(groups).toHaveLength(2);
  });
});
