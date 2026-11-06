import { describe, expect, test } from "bun:test";
import { BADGE_SIZE, badgeRgba } from "../src/lib/badge-icon.ts";

const pixel = (rgba: number[], x: number, y: number) => {
  const at = (y * BADGE_SIZE + x) * 4;
  return rgba.slice(at, at + 4);
};
const RED = [217, 45, 32, 255];
const WHITE = [255, 255, 255, 255];

describe("selo-barra: the overlay icon (issue #233)", () => {
  test("none unread draws nothing, so the badge is cleared", () => {
    expect(badgeRgba(0)).toBeNull();
    expect(badgeRgba(-3)).toBeNull();
    expect(badgeRgba(Number.NaN)).toBeNull();
  });

  test("a 32 x 32 picture of 4 bytes a pixel, a red disc on a clear background", () => {
    const icon = badgeRgba(3) as number[];
    expect(icon).toHaveLength(BADGE_SIZE * BADGE_SIZE * 4);
    expect(pixel(icon, 0, 0)[3]).toBe(0);
    expect(pixel(icon, 31, 31)[3]).toBe(0);
    expect(pixel(icon, 16, 2)).toEqual(RED);
    expect(pixel(icon, 3, 16)).toEqual(RED);
    expect(icon.every((byte) => byte >= 0 && byte <= 255 && Number.isInteger(byte))).toBe(true);
  });

  test("the number is white on the disc: a 1 has its stem where the glyph puts it", () => {
    const one = badgeRgba(1) as number[];
    // The glyph is 5 x 7 cells of 3 px, centred: its stem is the middle column.
    expect(pixel(one, 15, 6)).toEqual(WHITE);
    expect(pixel(one, 15, 24)).toEqual(WHITE);
    expect(pixel(one, 9, 6)).toEqual(RED);
  });

  test("each digit looks different", () => {
    const looks = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (badgeRgba(n) as number[]).join()),
    );
    expect(looks.size).toBe(9);
  });

  test("past nine it reads 9+, the same whatever the count", () => {
    const many = badgeRgba(10) as number[];
    expect(badgeRgba(99)).toEqual(many);
    expect(badgeRgba(1000)).toEqual(many);
    expect(many.join()).not.toBe((badgeRgba(9) as number[]).join());
    // The plus sign's bar crosses the middle of the right half.
    expect(pixel(many, 21, 16)).toEqual(WHITE);
  });

  test("a count that is not a whole number counts as the whole part", () => {
    expect(badgeRgba(2.9)).toEqual(badgeRgba(2));
  });
});
