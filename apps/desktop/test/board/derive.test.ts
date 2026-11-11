import { describe, expect, test } from "bun:test";
import {
  boardOrder,
  dropPositions,
  shownCards,
  startableWorkflows,
  stayingPicks,
} from "../../src/features/board/board-derive.ts";

/**
 * #1605 (Humble Object): what BoardView derives from its state, tested by output and without the DOM.
 */
const card = (id: string, over: object = {}) =>
  ({
    id,
    title: `card ${id}`,
    description: "",
    column: "backlog",
    position: 0,
    waitingOn: [],
    worktreePath: null,
    ...over,
  }) as never;

describe("board derive: the cards the board shows", () => {
  const all = [
    card("a", { title: "Fix login", waitingOn: ["b"] }),
    card("b", { title: "Add logout", worktreePath: "/wt/x" }),
    card("c", { title: "Fix cache", worktreePath: "/wt/x", waitingOn: ["a"] }),
  ];

  test("the text filter keeps the cards that match it, ignoring case", () => {
    expect(shownCards(all, "fix", false, null).map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("only blocked keeps the cards that wait on another", () => {
    expect(shownCards(all, "", true, null).map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("a picked worktree keeps its cards, and the main checkout the ones with none", () => {
    expect(
      shownCards(all, "", false, { kind: "worktree", path: "/wt/x" } as never).map((c) => c.id),
    ).toEqual(["b", "c"]);
    expect(shownCards(all, "", false, { kind: "primary" } as never).map((c) => c.id)).toEqual(["a"]);
  });

  test("the filters stack", () => {
    expect(
      shownCards(all, "fix", true, { kind: "worktree", path: "/wt/x" } as never).map((c) => c.id),
    ).toEqual(["c"]);
  });

  test("the board's order runs column by column, top to bottom", () => {
    const cards = [
      card("p", { column: "review" }),
      card("q", { column: "backlog" }),
      card("r", { column: "review" }),
      card("s", { column: "in_progress" }),
    ];
    expect(boardOrder(cards)).toEqual(["q", "s", "p", "r"]);
  });
});

describe("board derive: a dropped group", () => {
  const column = [
    card("a", { position: 1 }),
    card("b", { position: 2 }),
    card("c", { position: 3 }),
  ];

  test("lands right before the card it was dropped on, in order", () => {
    expect(dropPositions(column, [card("x"), card("y")], "c")).toEqual([2 + 1 / 3, 2 + 2 / 3]);
  });

  test("the group's own cards are left out of the column it lands among", () => {
    expect(dropPositions(column, [card("b")], "c")).toEqual([2]);
  });

  test("dropped on one of its own cards, or on no card, it takes no position", () => {
    expect(dropPositions(column, [card("b")], "b")).toBeUndefined();
    expect(dropPositions(column, [card("x")], undefined)).toBeUndefined();
  });
});

describe("board derive: the selection after a bulk action", () => {
  test("a card the action moved leaves the selection, a refused one stays, the rest are untouched", () => {
    expect(stayingPicks(["a", "b", "c", "d"], ["a", "b", "c"], ["b"])).toEqual(["b", "d"]);
  });
});

describe("board derive: the workflows a card can start with", () => {
  const w = (name: string, over: object = {}) => ({
    name,
    inputs: [`${name}-in`],
    trusted: true,
    errors: [],
    ...over,
  });

  test("only a trusted workflow with no errors goes, as its name and inputs", () => {
    expect(
      startableWorkflows([
        w("ok"),
        w("untrusted", { trusted: false }),
        w("broken", { errors: ["bad step"] }),
      ] as never),
    ).toEqual([{ name: "ok", inputs: ["ok-in"] }]);
  });

  test("a read with no list is no workflows", () => {
    expect(startableWorkflows(undefined)).toEqual([]);
  });
});
