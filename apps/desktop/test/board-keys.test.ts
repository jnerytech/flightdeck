import { describe, expect, test } from "bun:test";
import { boardKey } from "../src/lib/board-keys.ts";

/**
 * Issue #1198 (round 6 of #168): reaching a card in Done took a Tab press per card. The board is
 * one Tab stop: the arrows move between its cards, `s` starts the focused one, `m` shows its
 * actions. Columns: Backlog a1 a2 a3, In progress empty, Needs you c1, In review empty, Done e1 e2.
 */
const board = [["a1", "a2", "a3"], [], ["c1"], [], ["e1", "e2"]];
const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const to = (at: string, k: string) => {
  const action = boardKey(board, at, key(k), false);
  return action?.kind === "focus" ? action.cardId : null;
};

describe("board-keys: the arrows move between the board's cards (#1198)", () => {
  test("up and down stay in the column, and stop at its ends", () => {
    expect([to("a1", "ArrowDown"), to("a2", "ArrowUp"), to("a3", "ArrowDown"), to("a1", "ArrowUp")]).toEqual([
      "a2",
      "a1",
      null,
      null,
    ]);
  });

  test("Home and End go to the column's first and last card", () => {
    expect([to("a3", "Home"), to("a1", "End"), to("a1", "Home"), to("e2", "End")]).toEqual(["a1", "a3", null, null]);
  });

  test("left and right skip empty columns and keep the row where they can", () => {
    expect([to("a3", "ArrowRight"), to("c1", "ArrowRight"), to("e2", "ArrowLeft"), to("e1", "ArrowRight"), to("a2", "ArrowLeft")]).toEqual([
      "c1",
      "e1",
      "c1",
      null,
      null,
    ]);
  });

  test("a card in Done is three keys from the first card: right twice, then down", () => {
    const first = to("a1", "ArrowRight") ?? "";
    const done = to(first, "ArrowRight") ?? "";
    expect([first, done, to(done, "ArrowDown")]).toEqual(["c1", "e1", "e2"]);
  });

  test("s starts the card and m, the context menu key or Shift+F10 show its actions", () => {
    expect([
      boardKey(board, "a1", key("s"), false),
      boardKey(board, "a1", key("m"), false),
      boardKey(board, "a1", key("ContextMenu"), false),
      boardKey(board, "a1", key("F10", { shiftKey: true }), false),
    ]).toEqual([{ kind: "start" }, { kind: "menu" }, { kind: "menu" }, { kind: "menu" }]);
  });
});

describe("board-keys: what the board leaves alone (#1198)", () => {
  test("a key with Ctrl, Alt, Meta or Shift keeps its own meaning", () => {
    const mods = ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const;
    expect(mods.map((m) => boardKey(board, "a1", key("ArrowDown", { [m]: true }), false))).toEqual([null, null, null, null]);
    expect(mods.map((m) => boardKey(board, "a1", key("s", { [m]: true }), false))).toEqual([null, null, null, null]);
  });

  test("after g, the next key is the go-to chord's: g s goes to Sessions, it does not start the card", () => {
    expect([boardKey(board, "a1", key("s"), true), boardKey(board, "a1", key("m"), true)]).toEqual([null, null]);
  });

  test("a card that is not on the board, or another key, does nothing", () => {
    expect([boardKey(board, "zz", key("ArrowDown"), false), boardKey(board, "a1", key("x"), false)]).toEqual([null, null]);
  });
});
