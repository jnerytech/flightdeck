import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { paletteSections } from "../src/lib/palette.ts";
import { SessionViews } from "../src/lib/session-views.ts";
import { runPaletteTarget } from "../src/ui/App.tsx";

const state = () =>
  ({
    hosts: [],
    sessions: {},
    hub: {},
    externals: {},
    meta: {},
    cards: {},
    projects: {},
    ssh: {},
  }) as unknown as AppState;

const en = translator("en");
const items = (views?: Parameters<typeof paletteSections>[2]["views"], query = "") =>
  paletteSections(state(), query, { costs: false, t: en, ...(views ? { views } : {}) })
    .flatMap((section) => section.items)
    .filter((item) => item.id.startsWith("view:"));

describe("session-views-palette: the palette switches the view of the page on screen (issue #107)", () => {
  test("each view of the page is a command, with the Alt key that does the same", () => {
    const found = items(["conversation", "changes", "files"]);
    expect(found.map((item) => [item.id, item.label, item.shortcut])).toEqual([
      ["view:conversation", `Show ${en("changes.conversationTab")}`, "Alt+1"],
      ["view:changes", `Show ${en("changes.tab")}`, "Alt+2"],
      ["view:files", `Show ${en("files.tab")}`, "Alt+3"],
    ]);
    expect(found.map((item) => item.target)).toEqual([
      { kind: "session-view", view: "conversation" },
      { kind: "session-view", view: "changes" },
      { kind: "session-view", view: "files" },
    ]);
  });

  test("without a session page there is no view command, and the query narrows them", () => {
    expect(items()).toEqual([]);
    expect(items([])).toEqual([]);
    expect(items(["conversation", "changes", "files"], "chang").map((item) => item.id)).toEqual([
      "view:changes",
    ]);
  });

  test("running the command switches the page on screen", () => {
    const sessionViews = new SessionViews();
    const shown: string[] = [];
    sessionViews.register({
      key: "pc/a",
      views: ["conversation", "trace"],
      select: (view) => shown.push(view),
    });
    runPaletteTarget(
      { sessionViews } as unknown as Parameters<typeof runPaletteTarget>[0],
      { kind: "session-view", view: "trace" },
      { lang: "en", go: () => {}, showHelp: () => {} },
    );
    expect(shown).toEqual(["trace"]);
  });
});
