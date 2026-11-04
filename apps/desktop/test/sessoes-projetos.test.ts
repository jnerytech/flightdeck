import { describe, expect, test } from "bun:test";
import { DEFAULT_HUB_FILTER, type HubRow, hubGroups, hubView } from "../src/lib/hub.ts";

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

describe("sessoes-projetos: a project folds its history behind a count (issue #111)", () => {
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

  test("live first (needs you on top), the ended and history ones apart, newest first", () => {
    const [view] = hubView(group(), {}, {}, false);
    expect(view?.live.map((r) => r.key)).toEqual(["h/2", "h/1"]);
    expect(view?.earlier.map((r) => r.key)).toEqual(["h/5", "h/4", "h/3"]);
    expect(view?.expanded).toBe(true);
    // Folded behind the count: only the live ones are drawn.
    expect(view?.earlierShown).toBe(false);
    expect(view?.rows.map((r) => r.key)).toEqual(["h/2", "h/1"]);
  });

  test("the earlier ones come when asked for, and the whole group folds to nothing", () => {
    const key = group()[0]?.key as string;
    expect(hubView(group(), {}, { [key]: true }, false)[0]?.rows.map((r) => r.key)).toEqual([
      "h/2",
      "h/1",
      "h/5",
      "h/4",
      "h/3",
    ]);
    expect(hubView(group(), { [key]: false }, { [key]: true }, false)[0]?.rows).toEqual([]);
  });

  test("a project with nothing live starts folded, and a search opens everything", () => {
    const only = hubGroups([history(1), history(2)], DEFAULT_HUB_FILTER);
    const key = only[0]?.key as string;
    const view = hubView(only, {}, {}, false)[0];
    expect([view?.expanded, view?.rows, view?.earlier.length]).toEqual([false, [], 2]);
    expect(hubView(only, {}, {}, true)[0]?.rows.map((r) => r.key)).toEqual(["h/2", "h/1"]);
    // What the person chose wins over the default, searching or not.
    expect(hubView(only, { [key]: true }, {}, false)[0]?.expanded).toBe(true);
    expect(hubView(only, { [key]: false }, {}, true)[0]?.rows).toEqual([]);
  });
});
