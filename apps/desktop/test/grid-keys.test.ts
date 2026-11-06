import { describe, expect, test } from "bun:test";
import { gridStep } from "../src/lib/grid-keys.ts";

// Issue #669: the Board landing's cards are a grid whose column count follows its container, so
// the arrows read the cards' positions: left and right walk the order, up and down change row.
// Two rows of three, then one card: 0 1 2 / 3 4 5 / 6.
const rects = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
  left: (i % 3) * 300,
  top: Math.floor(i / 3) * 200,
}));

describe("grid-keys: the arrows move between cards laid out in a grid", () => {
  test("right and left walk the order and stop at the ends", () => {
    expect([
      gridStep(rects, 2, "ArrowRight"),
      gridStep(rects, 3, "ArrowLeft"),
      gridStep(rects, 6, "ArrowRight"),
      gridStep(rects, 0, "ArrowLeft"),
    ]).toEqual([3, 2, null, null]);
  });

  test("down and up go to the card in the next row nearest the same column", () => {
    expect([
      gridStep(rects, 1, "ArrowDown"),
      gridStep(rects, 4, "ArrowUp"),
      gridStep(rects, 5, "ArrowDown"),
      gridStep(rects, 6, "ArrowDown"),
      gridStep(rects, 2, "ArrowUp"),
    ]).toEqual([4, 1, 6, null, null]);
  });

  test("Home and End go to the first and the last card; any other key does nothing", () => {
    expect([
      gridStep(rects, 4, "Home"),
      gridStep(rects, 1, "End"),
      gridStep(rects, 1, "Enter"),
    ]).toEqual([0, 6, null]);
  });
});
