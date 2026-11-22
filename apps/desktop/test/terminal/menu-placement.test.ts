import { describe, expect, test } from "bun:test";
import { clampMenu } from "../../src/features/terminal/domain/menu-placement.ts";

const menu = { width: 120, height: 100 };
const viewport = { width: 720, height: 480 };

describe("clampMenu", () => {
  test("a click where the menu fits keeps the menu at the click point", () => {
    expect(clampMenu({ x: 40, y: 50 }, menu, viewport)).toEqual({ x: 40, y: 50 });
  });

  test("a click within the menu's width of the right edge pulls it back so it ends at the edge", () => {
    expect(clampMenu({ x: 700, y: 50 }, menu, viewport)).toEqual({ x: 600, y: 50 });
  });

  test("a click within the menu's height of the bottom edge pulls it back so it ends at the edge", () => {
    expect(clampMenu({ x: 40, y: 470 }, menu, viewport)).toEqual({ x: 40, y: 380 });
  });

  test("a click in the bottom right corner is pulled back on both axes", () => {
    expect(clampMenu({ x: 719, y: 479 }, menu, viewport)).toEqual({ x: 600, y: 380 });
  });

  test("a menu that exactly fits stays where it is", () => {
    expect(clampMenu({ x: 600, y: 380 }, menu, viewport)).toEqual({ x: 600, y: 380 });
  });

  test("a viewport smaller than the menu puts it at the top-left, never past the left or top edge", () => {
    expect(clampMenu({ x: 30, y: 40 }, menu, { width: 100, height: 80 })).toEqual({ x: 0, y: 0 });
  });
});
