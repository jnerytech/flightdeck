import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { type PaletteScope, paletteScope, paletteSections } from "../src/lib/palette.ts";

const en = translator("en");

const host = (id: string, name: string, sessions: unknown[], over: object = {}) => ({
  id,
  name,
  status: "online",
  sessions,
  hostInfo: { daemonVersion: "x", features: ["issues"] },
  ...over,
});
const live = (id: string, status: string, over: object = {}) => ({
  id,
  name: `sessão ${id}`,
  cwd: `/work/api/${id}`,
  status,
  ...over,
});

const state = (over: object = {}) =>
  ({
    hosts: [
      host("h1", "alfa", [
        live("a", "idle"),
        live("b", "running"),
        live("c", "awaiting_permission"),
        live("d", "idle"),
      ]),
      host("h2", "beta", [live("e", "idle", { cwd: "/srv/site/e" })]),
    ],
    sessions: {},
    hub: {},
    externals: {
      "h1/x": {
        claudeSessionId: "x",
        cwd: "/work/api",
        projectKey: "k",
        status: "awaiting_permission",
      },
    },
    meta: {},
    cards: {
      "h1/c1": { id: "c1", projectId: "p-api", title: "Fix login" },
      "h2/c2": { id: "c2", projectId: "p-site", title: "Fix footer" },
    },
    projects: {
      h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main", issues: null }],
      h2: [
        {
          id: "p-site",
          name: "site",
          path: "/srv/site",
          baseBranch: "main",
          issues: { provider: "github" },
        },
      ],
    },
    ssh: {},
    ...over,
  }) as unknown as AppState;

const all = (s: AppState, query = "", scope?: PaletteScope, recents?: string[], keep = false) =>
  paletteSections(s, query, {
    costs: true,
    t: en,
    ...(scope ? { scope } : {}),
    ...(recents ? { recents } : {}),
    ...(keep ? { keepRecentOrder: true } : {}),
  });
const items = (s: AppState, query = "", scope?: PaletteScope) =>
  all(s, query, scope).flatMap((section) => section.items);

describe("paleta-mais: rows know their state, host and project (issue #147)", () => {
  test("a live session carries its state, a terminal session that waits needs you", () => {
    const s = state();
    const byId = (id: string) => items(s).find((i) => i.id === id);
    expect(byId("session:h1/a")?.stateKey).toBe("idle");
    expect(byId("session:h1/b")?.stateKey).toBe("running");
    expect(byId("session:h1/c")?.stateKey).toBe("needs_you");
    expect(byId("external:h1/x")?.stateKey).toBe("needs_you");
    expect(byId("card:h1/c1")?.stateKey).toBeUndefined();
  });

  test("sessions, cards and projects say which host and project they are in", () => {
    const s = state();
    const byId = (id: string) => items(s).find((i) => i.id === id);
    expect(byId("session:h1/a")).toMatchObject({ hostId: "h1", projectId: "p-api" });
    expect(byId("card:h2/c2")).toMatchObject({ hostId: "h2", projectId: "p-site" });
    expect(byId("project:h1/p-api")).toMatchObject({ hostId: "h1", projectId: "p-api" });
    expect(byId("host:h1")).toMatchObject({ hostId: "h1" });
  });
});

describe("paleta-mais: recents, the ones that need you first, six at most (issue #147)", () => {
  const ids = ["session:h1/a", "session:h1/b", "session:h1/c", "session:h1/d", "session:h2/e"];
  const recent = (s: AppState, recents: string[], keep = false) =>
    all(s, "", undefined, recents, keep)
      .find((section) => section.recent)
      ?.items.map((i) => i.id);

  test("needs you, then running, then the rest, each group in the order they were used", () => {
    expect(recent(state(), ids)).toEqual([
      "session:h1/c",
      "session:h1/b",
      "session:h1/a",
      "session:h1/d",
      "session:h2/e",
    ]);
  });

  test("an entry with no state ranks with the idle ones, and at most six show", () => {
    const many = [...ids, "card:h1/c1", "card:h2/c2", "project:h1/p-api"];
    const shown = recent(state(), many) ?? [];
    expect(shown).toHaveLength(6);
    expect(shown.slice(0, 2)).toEqual(["session:h1/c", "session:h1/b"]);
  });

  test("frozen, the list is taken as given: a session that now needs you does not jump", () => {
    expect(recent(state(), ids, true)).toEqual(ids);
  });

  test("a typed query has no recents", () => {
    expect(all(state(), "a", undefined, ids).some((section) => section.recent)).toBe(false);
  });
});

describe("paleta-mais: the scope (issue #147)", () => {
  test("a board or a card seeds host and project; a session or a host page, the host", () => {
    const s = state();
    expect(paletteScope({ name: "board", host: "h1", projectId: "p-api" }, s)).toEqual({
      hostId: "h1",
      projectId: "p-api",
    });
    expect(
      paletteScope({ name: "card", host: "h2", projectId: "p-site", cardId: "c2" }, s),
    ).toEqual({
      hostId: "h2",
      projectId: "p-site",
    });
    expect(paletteScope({ name: "session", host: "h1", id: "a" }, s)).toEqual({
      hostId: "h1",
      projectId: null,
    });
    expect(paletteScope({ name: "host", host: "h2" }, s)).toEqual({
      hostId: "h2",
      projectId: null,
    });
    expect(paletteScope({ name: "hub" }, s)).toEqual({ hostId: null, projectId: null });
  });

  test("a scope keeps what belongs to it and the actions, and drops the rest", () => {
    const s = state();
    const scoped = items(s, "", { hostId: "h1", projectId: "p-api" });
    expect(scoped.some((i) => i.id === "card:h2/c2")).toBe(false);
    expect(scoped.some((i) => i.id === "session:h2/e")).toBe(false);
    expect(scoped.some((i) => i.id === "card:h1/c1")).toBe(true);
    expect(scoped.some((i) => i.id === "session:h1/a")).toBe(true);
    expect(scoped.some((i) => i.id === "go:hub")).toBe(true);
  });

  test("a host alone keeps every project of that host", () => {
    const scoped = items(state(), "", { hostId: "h2", projectId: null });
    expect(scoped.some((i) => i.id === "project:h2/p-site")).toBe(true);
    expect(scoped.some((i) => i.id === "project:h1/p-api")).toBe(false);
  });
});

describe("paleta-mais: the create row (issue #147)", () => {
  const create = (query: string, scope?: PaletteScope, s = state()) =>
    all(s, query, scope).find((section) => section.title === "Create");

  test("text that matches no card offers a card in the scope's project, last", () => {
    const sections = all(state(), "Brand new thing", { hostId: "h1", projectId: "p-api" });
    expect(sections.at(-1)?.title).toBe("Create");
    expect(sections.at(-1)?.items).toEqual([
      expect.objectContaining({
        label: "Create card “Brand new thing” in api",
        target: { kind: "create-card", hostId: "h1", projectId: "p-api", title: "Brand new thing" },
      }),
    ]);
  });

  test("a query that matches a card does not offer it; neither does an empty one", () => {
    expect(create("fix login", { hostId: "h1", projectId: "p-api" })).toBeUndefined();
    expect(create("", { hostId: "h1", projectId: "p-api" })).toBeUndefined();
    expect(create("   ", { hostId: "h1", projectId: "p-api" })).toBeUndefined();
  });

  test("with no scope, the only project of the only online host is the place; else there is none", () => {
    const one = state({
      hosts: [host("h1", "alfa", [])],
      projects: { h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main" }] },
      cards: {},
    });
    expect(create("Thing", undefined, one)?.items[0]?.label).toBe("Create card “Thing” in api");
    expect(create("Thing")).toBeUndefined();
  });

  test("a host alone in scope with one project uses it", () => {
    expect(create("Thing", { hostId: "h2", projectId: null })?.items[0]?.label).toBe(
      "Create card “Thing” in site",
    );
  });

  test("a GitHub issue link offers a card from the issue when the project has Issues connected", () => {
    const link = "https://github.com/acme/site/issues/42";
    const section = create(link, { hostId: "h2", projectId: "p-site" });
    expect(section?.items.map((i) => i.target)).toEqual([
      {
        kind: "create-card-issue",
        hostId: "h2",
        projectId: "p-site",
        ref: "github:acme/site#42",
      },
    ]);
    expect(section?.items[0]?.label).toBe("Create card from issue acme/site#42 in site");
    // The project without an issue provider offers a plain card instead.
    expect(create(link, { hostId: "h1", projectId: "p-api" })?.items[0]?.target.kind).toBe(
      "create-card",
    );
  });

  test("#123 names the issue of the project's provider by its number", () => {
    const section = create("#123", { hostId: "h2", projectId: "p-site" });
    expect(section?.items[0]).toMatchObject({
      label: "Create card from issue #123 in site",
      target: { kind: "create-card-issue", hostId: "h2", projectId: "p-site", id: "123" },
    });
  });

  test("a host without the issues feature never offers an issue", () => {
    const s = state({
      hosts: [host("h2", "beta", [], { hostInfo: { daemonVersion: "x", features: [] } })],
    });
    expect(create("#9", { hostId: "h2", projectId: "p-site" }, s)?.items[0]?.target.kind).toBe(
      "create-card",
    );
  });
});
