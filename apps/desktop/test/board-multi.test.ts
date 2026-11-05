import { describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import {
  BoardWidth,
  COLUMN_WIDTH,
  COLUMN_WIDTH_KEY,
  clampWidth,
  columnCount,
  moveMany,
  pruneSelection,
  rangeSelection,
  shownSelection,
  toggleSelection,
} from "../src/lib/board-select.ts";
import type { Platform } from "../src/platform/types.ts";

describe("board-multi: the selection (issue #161)", () => {
  test("Ctrl-click adds a card and takes it out again, keeping the others", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  test("Shift-click selects from the anchor to the target in the column's order, either way", () => {
    const order = ["a", "b", "c", "d", "e"];
    expect(rangeSelection(order, "b", "d", [])).toEqual(["b", "c", "d"]);
    expect(rangeSelection(order, "d", "b", [])).toEqual(["b", "c", "d"]);
    expect(rangeSelection(order, "c", "c", [])).toEqual(["c"]);
  });

  test("a range keeps what was selected elsewhere and counts nothing twice", () => {
    expect(rangeSelection(["a", "b", "c"], "a", "b", ["x", "b"])).toEqual(["x", "b", "a"]);
  });

  test("with no anchor in this column the target alone is selected", () => {
    expect(rangeSelection(["a", "b"], null, "b", [])).toEqual(["b"]);
    expect(rangeSelection(["a", "b"], "z", "b", ["q"])).toEqual(["q", "b"]);
  });

  test("cards that are gone leave the selection", () => {
    expect(pruneSelection(["a", "b", "c"], new Set(["a", "c", "d"]))).toEqual(["a", "c"]);
    expect(pruneSelection([], [])).toEqual([]);
  });

  test("gestures use the selected cards that are shown, in the board's order", () => {
    expect(shownSelection(["c", "a", "x"], ["a", "b", "c"])).toEqual(["a", "c"]);
    expect(shownSelection([], ["a"])).toEqual([]);
  });
});

describe("board-multi: the column width (issue #161)", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
      storage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      } as unknown as Platform["storage"],
      data,
    };
  };

  test("260 px by default, between 220 and 520, in steps of 20", () => {
    expect(COLUMN_WIDTH).toEqual({ default: 260, min: 220, max: 520, step: 20 });
    expect(clampWidth(100)).toBe(220);
    expect(clampWidth(900)).toBe(520);
    expect(clampWidth(333)).toBe(333);
    expect(clampWidth(Number.NaN)).toBe(260);
  });

  test("the width is kept and comes back after a restart; a stored nonsense is the default", () => {
    const kept = memory();
    const w = new BoardWidth(kept.storage);
    expect(w.value).toBe(260);
    w.set(300);
    expect(kept.data.get(COLUMN_WIDTH_KEY)).toBe("300");
    expect(new BoardWidth(kept.storage).value).toBe(300);
    expect(new BoardWidth(memory({ [COLUMN_WIDTH_KEY]: "banana" }).storage).value).toBe(260);
    expect(new BoardWidth(memory({ [COLUMN_WIDTH_KEY]: "9000" }).storage).value).toBe(520);
  });

  test("a value out of range is clamped, and the listeners are told", () => {
    const w = new BoardWidth(memory().storage);
    let told = 0;
    w.subscribe(() => told++);
    w.set(10);
    expect(w.value).toBe(220);
    w.set(1000);
    expect(w.value).toBe(520);
    expect(told).toBe(2);
  });
});

describe("board-multi: the counts (issue #161)", () => {
  test("a number, or n / total while a filter hides some", () => {
    expect(columnCount(3, 3, false)).toBe("3");
    expect(columnCount(2, 5, true)).toBe("2 / 5");
    expect(columnCount(0, 4, true)).toBe("0 / 4");
    expect(columnCount(3, 3, true)).toBe("3 / 3");
    expect(columnCount(0, 0, false)).toBe("0");
  });
});

const card = (id: string): Card => ({ id, title: id }) as unknown as Card;

describe("board-multi: moving many cards (issue #161)", () => {
  test("each card goes to the column in order, one after the other", async () => {
    const calls: string[] = [];
    const refused = await moveMany(
      [card("a"), card("b"), card("c")],
      "done",
      async (id, column) => {
        calls.push(`${id}>${column}`);
        return { ok: true };
      },
    );
    expect(calls).toEqual(["a>done", "b>done", "c>done"]);
    expect(refused).toEqual([]);
  });

  test("a card the host refuses stays and comes back named, and the rest still move", async () => {
    const calls: string[] = [];
    const refused = await moveMany([card("a"), card("b"), card("c")], "done", async (id) => {
      calls.push(id);
      return id === "b"
        ? { ok: false, message: "a card that is running cannot be completed" }
        : { ok: true };
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(refused.map((r) => [r.card.id, r.message])).toEqual([
      ["b", "a card that is running cannot be completed"],
    ]);
  });

  test("they do not run at the same time: the order is the board's", async () => {
    let running = 0;
    let most = 0;
    await moveMany([card("a"), card("b"), card("c")], "review", async () => {
      running++;
      most = Math.max(most, running);
      await Bun.sleep(1);
      running--;
      return { ok: true };
    });
    expect(most).toBe(1);
  });
});
