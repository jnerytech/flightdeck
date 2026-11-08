import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { type PaletteScope, paletteSections } from "../src/lib/palette.ts";

const host = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  status: "online",
  sessions: [],
  hostInfo: { daemonVersion: "x", features: [] },
  ...over,
});

const state = (over: object = {}) =>
  ({
    hosts: [host("h1", "alfa"), host("h2", "beta")],
    sessions: {},
    hub: {},
    externals: {},
    meta: {},
    cards: { "h1/c1": { id: "c1", projectId: "p-api", title: "Fix login" } },
    projects: {
      h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main", issues: null }],
      h2: [{ id: "p-site", name: "site", path: "/srv/site", baseBranch: "main", issues: null }],
    },
    ssh: {},
    ...over,
  }) as unknown as AppState;

const SCOPE: PaletteScope = { hostId: "h1", projectId: "p-api" };

const start = (query: string, scope?: PaletteScope, s = state(), lang: "en" | "pt-BR" = "en") => {
  const t = translator(lang);
  return paletteSections(s, query, { costs: true, t, ...(scope ? { scope } : {}) }).find(
    (section) => section.title === t("palette.sectionStart"),
  );
};

// Issue #1135: text typed in the palette can start a session in the project, with it as the task.
describe("paleta-iniciar: Start in <project>: <text>", () => {
  test("text with a project in scope offers a session in the project's folder, with the text as its prompt", () => {
    const section = start("fix the login bug on mobile", SCOPE);
    expect(section?.title).toBe("Start");
    expect(section?.items).toEqual([
      expect.objectContaining({
        label: "Start in api: fix the login bug on mobile",
        detail: "New session",
        target: {
          kind: "start-session",
          hostId: "h1",
          cwd: "/work/api",
          prompt: "fix the login bug on mobile",
        },
        hostId: "h1",
        projectId: "p-api",
      }),
    ]);
  });

  test("it comes before Create card, which keeps its place last", () => {
    const sections = paletteSections(state(), "Brand new thing", {
      costs: true,
      t: translator("en"),
      scope: SCOPE,
    });
    expect(sections.map((section) => section.title).slice(-2)).toEqual(["Start", "Create"]);
  });

  test("the text is trimmed, and a query that matches a card still offers it", () => {
    const section = start("  fix login  ", SCOPE);
    expect(section?.items[0]?.target).toEqual({
      kind: "start-session",
      hostId: "h1",
      cwd: "/work/api",
      prompt: "fix login",
    });
  });

  test("one word that finds a row is a search, not a task; one that finds nothing is offered", () => {
    expect(start("fix", SCOPE)).toBeUndefined();
    expect(start("refactor", SCOPE)?.items[0]?.label).toBe("Start in api: refactor");
  });

  test("a lone issue number or link is for Create card, not for a session", () => {
    expect(start("#123", SCOPE)).toBeUndefined();
    expect(start("https://github.com/o/r/issues/5", SCOPE)).toBeUndefined();
  });

  test("an empty or blank query offers nothing", () => {
    expect(start("", SCOPE)).toBeUndefined();
    expect(start("   ", SCOPE)).toBeUndefined();
  });

  test("with no scope it is offered only when there is one project to start in", () => {
    expect(start("Do the Thing")).toBeUndefined();
    const one = state({ hosts: [host("h1", "alfa")], cards: {} });
    expect(start("Do the Thing", undefined, one)?.items[0]?.label).toBe(
      "Start in api: Do the Thing",
    );
  });

  test("a project of the other host is the place when the scope names it", () => {
    const section = start("Do the Thing", { hostId: "h2", projectId: "p-site" });
    expect(section?.items[0]?.target).toMatchObject({ hostId: "h2", cwd: "/srv/site" });
  });

  test("a long task is cut in the label, never in the prompt", () => {
    const long = `${"word ".repeat(40)}end`;
    const item = start(long, SCOPE)?.items[0];
    expect(item?.label.length).toBeLessThan(80);
    expect(item?.label.endsWith("…")).toBe(true);
    expect(item?.target).toMatchObject({ prompt: long });
  });

  test("it reads in Portuguese too", () => {
    const section = start("corrigir o login", SCOPE, state(), "pt-BR");
    expect(section?.title).toBe("Iniciar");
    expect(section?.items[0]?.label).toBe("Iniciar em api: corrigir o login");
  });
});
