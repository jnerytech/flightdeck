import { describe, expect, test } from "bun:test";
import type { PendingPermission, SessionSummary } from "@flightdeck/protocol";
import { BADGE_SIZE, badgeRgba } from "../src/lib/badge-icon.ts";
import { trayStatus } from "../src/lib/tray.ts";

const pending = (n: number): PendingPermission[] =>
  Array.from({ length: n }, (_, i) => ({
    requestId: `r${i}`,
    toolName: "Bash",
    createdAt: "2026-10-28T00:00:00.000Z",
  }));

const session = (n: number) =>
  ({ pendingPermissions: pending(n) }) as Pick<SessionSummary, never> & {
    pendingPermissions: PendingPermission[];
  };

describe("badge-bandeja", () => {
  test("sem pedidos: contagem zero e dica neutra", () => {
    expect(trayStatus([])).toEqual({
      count: 0,
      label: "Precisa de você (0)",
      tooltip: "Flightdeck: nada esperando você",
    });
    expect(trayStatus([{ name: "pc", sessions: [session(0)] }])).toEqual({
      count: 0,
      label: "Precisa de você (0)",
      tooltip: "Flightdeck: nada esperando você",
    });
  });

  test("um pedido usa singular e cita o host", () => {
    expect(trayStatus([{ name: "pc", sessions: [session(1), session(0)] }])).toEqual({
      count: 1,
      label: "Precisa de você (1)",
      tooltip: "Flightdeck: 1 pedido esperando você (pc: 1)",
    });
  });

  test("soma todos os hosts, lista do maior para o menor e ignora hosts sem pedido", () => {
    expect(
      trayStatus([
        { name: "vps", sessions: [session(1)] },
        { name: "wsl", sessions: [] },
        { name: "pc", sessions: [session(2), session(1)] },
        { name: "pi", sessions: [session(1)] },
      ]),
    ).toEqual({
      count: 5,
      label: "Precisa de você (5)",
      tooltip: "Flightdeck: 5 pedidos esperando você (pc: 3, pi: 1, vps: 1)",
    });
  });
});

type Dot = { x: number; y: number; r: number; g: number; b: number; a: number };

const pixels = (rgba: number[]): Dot[] =>
  Array.from({ length: BADGE_SIZE * BADGE_SIZE }, (_, i) => ({
    x: i % BADGE_SIZE,
    y: Math.floor(i / BADGE_SIZE),
    r: rgba[i * 4] ?? -1,
    g: rgba[i * 4 + 1] ?? -1,
    b: rgba[i * 4 + 2] ?? -1,
    a: rgba[i * 4 + 3] ?? -1,
  }));
const isRed = (p: Dot) => p.a === 255 && p.r === 217 && p.g === 45 && p.b === 32;
const isWhite = (p: Dot) => p.a === 255 && p.r === 255 && p.g === 255 && p.b === 255;
const across = (dots: Dot[], axis: "x" | "y") =>
  dots.length === 0
    ? 0
    : Math.max(...dots.map((p) => p[axis])) - Math.min(...dots.map((p) => p[axis])) + 1;
// The distance of a pixel's centre from the middle of the 32 x 32 picture.
const fromMiddle = (p: Dot) => Math.hypot(p.x + 0.5 - BADGE_SIZE / 2, p.y + 0.5 - BADGE_SIZE / 2);
const rgbaOf = (count: number, mode?: "count" | "dot") => badgeRgba(count, mode) as number[];

describe("badge-icon: the taskbar badge (issue #632)", () => {
  test("none unread gives no picture, in both modes", () => {
    expect(badgeRgba(0)).toBeNull();
    expect(badgeRgba(-4)).toBeNull();
    expect(badgeRgba(0, "dot")).toBeNull();
    expect(badgeRgba(-1, "dot")).toBeNull();
  });

  test("the picture stays 32 x 32 pixels of 4 bytes, each a whole byte", () => {
    for (const mode of ["count", "dot"] as const) {
      const icon = rgbaOf(3, mode);
      expect(icon).toHaveLength(32 * 32 * 4);
      expect(icon.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)).toBe(true);
    }
    expect(rgbaOf(3)).toHaveLength(BADGE_SIZE * BADGE_SIZE * 4);
  });

  test("the top-left corner is transparent", () => {
    for (const count of [1, 5, 10]) {
      expect(pixels(rgbaOf(count))[0]?.a).toBe(0);
    }
    expect(pixels(rgbaOf(5, "dot"))[0]?.a).toBe(0);
  });

  test("the disc edge is anti-aliased: some pixel is neither clear nor opaque", () => {
    for (const count of [1, 10]) {
      expect(pixels(rgbaOf(count)).some((p) => p.a > 0 && p.a < 255)).toBe(true);
    }
    expect(pixels(rgbaOf(1, "dot")).some((p) => p.a > 0 && p.a < 255)).toBe(true);
  });

  test("the badge leaves a margin: nothing is drawn past a 26 px disc", () => {
    for (const count of [1, 10]) {
      const drawn = pixels(rgbaOf(count)).filter((p) => p.a > 0);
      expect(drawn.length).toBeGreaterThan(0);
      expect(across(drawn, "x")).toBeLessThanOrEqual(26);
      expect(across(drawn, "y")).toBeLessThanOrEqual(26);
      // A pixel the disc only touches has its centre up to half a pixel diagonal outside it.
      expect(drawn.every((p) => fromMiddle(p) <= 13.75)).toBe(true);
    }
  });

  test("the opaque red area is at most 26 px across, and is a real disc", () => {
    for (const count of [1, 10]) {
      const red = pixels(rgbaOf(count)).filter(isRed);
      expect(across(red, "x")).toBeLessThanOrEqual(26);
      expect(across(red, "y")).toBeLessThanOrEqual(26);
      expect(across(red, "x")).toBeGreaterThanOrEqual(18);
      expect(across(red, "y")).toBeGreaterThanOrEqual(18);
    }
  });

  test("a white ring edges the disc, so it reads on a light taskbar", () => {
    const ring = pixels(rgbaOf(1)).filter((p) => isWhite(p) && fromMiddle(p) >= 11.5);
    expect(ring.length).toBeGreaterThan(40);
    expect(ring.every((p) => fromMiddle(p) <= 13)).toBe(true);
    expect(
      pixels(rgbaOf(1)).find((p) => p.x === 16 && p.y === 4 && isWhite(p)),
    ).not.toBeUndefined();
  });

  test("the digits are bold: a white stroke at least 3 px wide, drawn inside the disc", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const digit = pixels(rgbaOf(count)).filter((p) => isWhite(p) && fromMiddle(p) < 11);
      expect(digit.length).toBeGreaterThan(20);
      const widest = Math.max(
        ...Array.from({ length: BADGE_SIZE }, (_, y) => {
          const row = digit.filter((p) => p.y === y).map((p) => p.x);
          let run = 0;
          let best = 0;
          for (let x = 0; x < BADGE_SIZE; x++) {
            run = row.includes(x) ? run + 1 : 0;
            best = Math.max(best, run);
          }
          return best;
        }),
      );
      expect(widest).toBeGreaterThanOrEqual(3);
    }
  });

  test("every white digit pixel lies inside the disc, a red gap before the ring, for 1 to 9 and 9+", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const white = pixels(rgbaOf(count)).filter(isWhite);
      const digit = white.filter((p) => fromMiddle(p) < 11);
      expect(digit.length).toBeGreaterThan(0);
      expect(white.every((p) => fromMiddle(p) <= 13)).toBe(true);
      expect(digit.every((p) => fromMiddle(p) <= 10.2)).toBe(true);
    }
  });

  test("the digits are centred in the disc", () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const digit = pixels(rgbaOf(count)).filter((p) => isWhite(p) && fromMiddle(p) < 11);
      const minX = Math.min(...digit.map((p) => p.x));
      const maxX = Math.max(...digit.map((p) => p.x));
      const minY = Math.min(...digit.map((p) => p.y));
      const maxY = Math.max(...digit.map((p) => p.y));
      expect(Math.abs(minX + maxX + 1 - BADGE_SIZE)).toBeLessThanOrEqual(3);
      expect(Math.abs(minY + maxY + 1 - BADGE_SIZE)).toBeLessThanOrEqual(3);
    }
  });

  test("each digit looks different, and past nine it reads 9+ whatever the count", () => {
    const looks = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => rgbaOf(n).join()));
    expect(looks.size).toBe(10);
    expect(rgbaOf(99).join()).toBe(rgbaOf(10).join());
    expect(rgbaOf(2.9).join()).toBe(rgbaOf(2).join());
  });

  test("the dot is under 16 px across, at the bottom-right, with no number and no white", () => {
    const dot = pixels(rgbaOf(7, "dot"));
    const drawn = dot.filter((p) => p.a > 0);
    expect(across(drawn, "x")).toBeLessThan(16);
    expect(across(drawn, "y")).toBeLessThan(16);
    expect(across(drawn, "x")).toBeGreaterThanOrEqual(12);
    expect(across(drawn, "y")).toBeGreaterThanOrEqual(12);
    expect(dot.some((p) => p.a > 0 && p.r === 255 && p.g === 255 && p.b === 255)).toBe(false);
    expect(drawn.every((p) => p.x >= 16 && p.y >= 16)).toBe(true);
    expect(dot.some(isRed)).toBe(true);
    expect(rgbaOf(1, "dot").join()).toBe(rgbaOf(9, "dot").join());
    expect(rgbaOf(1, "dot").join()).not.toBe(rgbaOf(1).join());
  });

  test("the count is the default mode", () => {
    expect(rgbaOf(4).join()).toBe(rgbaOf(4, "count").join());
  });
});
