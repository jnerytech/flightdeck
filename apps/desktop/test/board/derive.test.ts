import { describe, expect, test } from "bun:test";
import {
  boardFeatures,
  boardOrder,
  cardMoves,
  columnCards,
  dropPositions,
  idsByColumn,
  refusalNames,
  showingColumn,
  shownCards,
  showsQueuedBadge,
  startableWorkflows,
  stayingPicks,
  tabStops,
} from "../../src/features/board/board-derive.ts";
import { translator } from "../../src/i18n/index.ts";

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
    expect(shownCards(all, "", false, { kind: "primary" } as never).map((c) => c.id)).toEqual([
      "a",
    ]);
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

describe("board derive: a column's cards", () => {
  test("come top to bottom, and only the column's own", () => {
    const all = [
      card("c", { column: "review", position: 3 }),
      card("a", { column: "review", position: 1 }),
      card("x", { column: "done", position: 0 }),
      card("b", { column: "review", position: 2 }),
    ];
    expect(columnCards(all, "review").map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(columnCards(all, "waiting")).toEqual([]);
  });

  test("the ids a filter leaves are listed once per column, in the board's column order", () => {
    const shown = [
      card("p", { column: "review" }),
      card("q", { column: "backlog" }),
      card("r", { column: "review" }),
    ];
    expect(idsByColumn(shown)).toEqual([["q"], [], [], ["p", "r"], []]);
  });
});

describe("board derive: the column a narrow board shows", () => {
  const ids = [[], [], ["w1"], ["r1"], []];

  test("is the one the person picked", () => {
    expect(showingColumn("done", ids)).toBe("done");
  });

  test("is the first column with a card until one is picked", () => {
    expect(showingColumn(null, ids)).toBe("waiting");
  });

  test("is the backlog on an empty board", () => {
    expect(showingColumn(null, [[], [], [], [], []])).toBe("backlog");
  });
});

describe("board derive: each column's one Tab stop", () => {
  const ids = [["a", "b"], [], ["c", "d"], [], ["e"]];

  test("is the first card of a column until one is focused", () => {
    expect([...tabStops(ids, null)].sort()).toEqual(["a", "c", "e"]);
  });

  test("is the focused card in its column, and the first in the others", () => {
    expect([...tabStops(ids, "d")].sort()).toEqual(["a", "d", "e"]);
  });

  test("a focused card that is not on the board changes nothing", () => {
    expect([...tabStops(ids, "gone")].sort()).toEqual(["a", "c", "e"]);
  });
});

describe("board derive: the moves a card's menu offers", () => {
  const here = [card("a"), card("b"), card("c"), card("d")];

  test("one move to each other column, then up and down", () => {
    const { moves } = cardMoves(here, card("b", { column: "backlog" }));
    expect(moves.map((m) => m.key)).toEqual([
      "in_progress",
      "waiting",
      "review",
      "done",
      "up",
      "down",
    ]);
    expect(moves.slice(0, 4).map((m) => m.column)).toEqual([
      "in_progress",
      "waiting",
      "review",
      "done",
    ]);
  });

  test("up lands before the card above, and down before the one two places below", () => {
    const { index, moves } = cardMoves(here, card("b", { column: "backlog" }));
    expect(index).toBe(1);
    expect(moves.find((m) => m.key === "up")).toEqual({
      key: "up",
      column: "backlog",
      targetId: "a",
      disabled: false,
    });
    expect(moves.find((m) => m.key === "down")).toEqual({
      key: "down",
      column: "backlog",
      targetId: "d",
      disabled: false,
    });
  });

  test("the first card cannot go up, and the last cannot go down", () => {
    const first = cardMoves(here, card("a", { column: "backlog" }));
    expect(first.moves.find((m) => m.key === "up")?.disabled).toBe(true);
    const last = cardMoves(here, card("d", { column: "backlog" }));
    expect(last.moves.find((m) => m.key === "down")?.disabled).toBe(true);
  });

  test("the one before the last goes down to the end, with no card to land before", () => {
    const { moves } = cardMoves(here, card("c", { column: "backlog" }));
    expect(moves.find((m) => m.key === "down")).toEqual({
      key: "down",
      column: "backlog",
      targetId: undefined,
      disabled: false,
    });
  });
});

describe("board derive: what the host offers the board", () => {
  test("each of deps, roi, boardsync and issues is on when the host announces it", () => {
    expect(boardFeatures(["deps", "boardsync"])).toEqual({
      deps: true,
      roi: false,
      sync: true,
      issues: false,
    });
    expect(boardFeatures(["roi", "issues", "other"])).toEqual({
      deps: false,
      roi: true,
      sync: false,
      issues: true,
    });
  });

  test("a host that announces nothing, or is not known, offers none", () => {
    const none = { deps: false, roi: false, sync: false, issues: false };
    expect(boardFeatures([])).toEqual(none);
    expect(boardFeatures(undefined)).toEqual(none);
  });
});

describe("board derive: the queued badge", () => {
  test("a queued card with no reason, or the slot or budget reason, shows it", () => {
    expect(showsQueuedBadge({ queued: true, queueReason: null })).toBe(true);
    expect(showsQueuedBadge({ queued: true, queueReason: "slot" })).toBe(true);
    expect(showsQueuedBadge({ queued: true, queueReason: "budget" })).toBe(true);
  });

  test("quota, memory and paused have a badge of their own, so no second one", () => {
    for (const queueReason of ["quota", "memory", "paused"] as const) {
      expect(showsQueuedBadge({ queued: true, queueReason })).toBe(false);
    }
  });

  test("a card that is not queued shows none", () => {
    expect(showsQueuedBadge({ queued: false, queueReason: null })).toBe(false);
  });
});

describe("board derive: the refusals named", () => {
  const refusal = (title: string, over: object = {}) =>
    ({ card: { title }, message: "the card is running", ...over }) as never;

  test("each title with the host's message, joined by commas", () => {
    expect(
      refusalNames([refusal("A"), refusal("B", { message: "no room" })], translator("en")),
    ).toBe("A (the card is running), B (no room)");
  });

  test("a reason code is said in the app's language", () => {
    const coded = [refusal("A", { reason: "card_running" })];
    expect(refusalNames(coded, translator("en"))).toBe(
      "A (The card is running: wait for the agent to finish.)",
    );
    expect(refusalNames(coded, translator("pt-BR"))).toBe(
      "A (O card está em execução: espere o agente terminar.)",
    );
  });

  test("none refused, an empty text", () => {
    expect(refusalNames([], translator("en"))).toBe("");
  });
});
