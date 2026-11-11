import { describe, expect, test } from "bun:test";
import { ViewPrefsSlice } from "../../src/features/viewprefs/index.ts";

/** Prefs over a map that stands in for this computer's storage; a second slice is the next start. */
function prefs(kept = new Map<string, string>()) {
  return {
    kept,
    slice: new ViewPrefsSlice({
      storage: {
        getItem: (key) => kept.get(key) ?? null,
        setItem: (key, value) => void kept.set(key, value),
      },
    }),
  };
}

describe("view preferences (#1596)", () => {
  test("a fresh computer starts every window at its default", () => {
    const { slice } = prefs();
    expect({
      width: slice.listWidth(),
      view: slice.hubView(),
      open: slice.hubOpen(),
      roi: slice.roiOpen(),
      idle: slice.activityIdle(),
      layout: slice.tileLayout(),
      sidebar: slice.sidebarFolded(),
      treeFolded: slice.treeFolded(),
      treeOpened: slice.treeOpened(),
      treePinned: slice.treePinned(),
      board: slice.lastBoard("h1"),
      pinnedOnly: slice.hubFilter().pinnedOnly,
    }).toEqual({
      width: 380,
      view: "list",
      open: {},
      roi: false,
      idle: false,
      layout: "auto",
      sidebar: [],
      treeFolded: [],
      treeOpened: [],
      treePinned: [],
      board: null,
      pinnedOnly: false,
    });
  });

  test("what the person chose is there at the next start", () => {
    const first = prefs();
    first.slice.setListWidth(500);
    first.slice.saveHubView("cards");
    first.slice.saveHubOpen({ "folder:api": true });
    first.slice.saveRoiOpen(true);
    first.slice.setActivityIdle(true);
    first.slice.setTileLayout("2x2");
    first.slice.setSidebarFolded(["machines"]);
    first.slice.setTreeFolded(["h1/p-api"]);
    first.slice.setTreeOpened(["h1/p-web"]);
    first.slice.setTreePinned(["h1/p-cli"]);
    first.slice.rememberBoard("h1", "p-api");
    first.slice.saveHubFilter({ ...first.slice.hubFilter(), pinnedOnly: true });

    const next = prefs(first.kept).slice;
    expect({
      width: next.listWidth(),
      view: next.hubView(),
      open: next.hubOpen(),
      roi: next.roiOpen(),
      idle: next.activityIdle(),
      layout: next.tileLayout(),
      sidebar: next.sidebarFolded(),
      treeFolded: next.treeFolded(),
      treeOpened: next.treeOpened(),
      treePinned: next.treePinned(),
      board: next.lastBoard("h1"),
      pinnedOnly: next.hubFilter().pinnedOnly,
    }).toEqual({
      width: 500,
      view: "cards",
      open: { "folder:api": true },
      roi: true,
      idle: true,
      layout: "2x2",
      sidebar: ["machines"],
      treeFolded: ["h1/p-api"],
      treeOpened: ["h1/p-web"],
      treePinned: ["h1/p-cli"],
      board: "p-api",
      pinnedOnly: true,
    });
  });

  test("each choice is written under its own key", () => {
    const { slice, kept } = prefs();
    slice.setListWidth(500);
    slice.saveHubView("cards");
    slice.saveRoiOpen(true);
    slice.setActivityIdle(true);
    slice.setTreeOpened(["h1/p-web"]);
    slice.setTreePinned(["h1/p-cli"]);
    expect(Object.fromEntries(kept)).toEqual({
      "flightdeck.listWidth": "500",
      "flightdeck.hubView": "cards",
      "flightdeck.roiOpen": "true",
      "flightdeck.activityIdle": "true",
      "flightdeck.treeOpened": '["h1/p-web"]',
      "flightdeck.treePinned": '["h1/p-cli"]',
    });
  });

  test("a choice about one window leaves the others at their defaults", () => {
    const { slice } = prefs();
    slice.setTreePinned(["h1/p-cli"]);
    expect({
      folded: slice.treeFolded(),
      opened: slice.treeOpened(),
      idle: slice.activityIdle(),
      roi: slice.roiOpen(),
      view: slice.hubView(),
    }).toEqual({ folded: [], opened: [], idle: false, roi: false, view: "list" });
  });

  test("the board last opened is kept per host and replaced by the next one", () => {
    const { slice } = prefs();
    slice.rememberBoard("h1", "p-api");
    slice.rememberBoard("h2", "p-web");
    slice.rememberBoard("h1", "p-cli");
    expect([slice.lastBoard("h1"), slice.lastBoard("h2"), slice.lastBoard("h3")]).toEqual([
      "p-cli",
      "p-web",
      null,
    ]);
  });

  test("what the storage holds unreadable reads as the default", () => {
    const { slice } = prefs(
      new Map([
        ["flightdeck.sidebarFolded", "{broken"],
        ["flightdeck.hubOpen", "[1,2]"],
        ["flightdeck.lastBoards", "nope"],
        ["flightdeck.listWidth", "wide"],
      ]),
    );
    expect({
      sidebar: slice.sidebarFolded(),
      open: slice.hubOpen(),
      board: slice.lastBoard("h1"),
      width: slice.listWidth(),
    }).toEqual({ sidebar: [], open: {}, board: null, width: 380 });
  });
});
