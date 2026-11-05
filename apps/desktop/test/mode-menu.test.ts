import { describe, expect, test } from "bun:test";
import { MENU_MODES, modeRows, nextMode } from "../src/lib/mode-menu.ts";

const rows = (current: string, start: string, bypassAllowed: boolean) =>
  modeRows({ current: current as never, start: start as never, bypassAllowed });
const states = (list: ReturnType<typeof rows>) =>
  list.map((r) => `${r.mode}:${r.current ? "on" : "off"}:${r.blocked ?? "ok"}`);

describe("mode-menu: which modes the menu offers", () => {
  test("every settable mode is listed, in the order of the numbers", () => {
    expect(MENU_MODES).toEqual(["default", "acceptEdits", "plan", "bypassPermissions"]);
    expect(rows("default", "default", true).map((r) => r.mode)).toEqual([...MENU_MODES]);
  });

  test("the current mode is the checked one", () => {
    expect(states(rows("acceptEdits", "default", true))).toEqual([
      "default:off:ok",
      "acceptEdits:on:ok",
      "plan:off:ok",
      "bypassPermissions:off:ok",
    ]);
  });

  test("with the host switch off, bypass is listed but blocked, with its reason", () => {
    expect(states(rows("default", "acceptEdits", false))).toEqual([
      "default:on:ok",
      "acceptEdits:off:ok",
      "plan:off:ok",
      "bypassPermissions:off:bypassOff",
    ]);
  });

  test("with the switch off, a mode looser than the start mode is blocked", () => {
    expect(states(rows("plan", "plan", false))).toEqual([
      "default:off:looserThanStart",
      "acceptEdits:off:looserThanStart",
      "plan:on:ok",
      "bypassPermissions:off:bypassOff",
    ]);
    expect(states(rows("default", "default", false))).toEqual([
      "default:on:ok",
      "acceptEdits:off:looserThanStart",
      "plan:off:ok",
      "bypassPermissions:off:bypassOff",
    ]);
  });

  test("with the switch on, nothing but the current mode is held back", () => {
    expect(rows("plan", "plan", true).every((r) => r.blocked === null)).toBe(true);
  });

  test("a start mode outside the list (auto, bypass) holds nothing back but bypass itself", () => {
    expect(states(rows("auto", "auto", false))).toEqual([
      "default:off:ok",
      "acceptEdits:off:ok",
      "plan:off:ok",
      "bypassPermissions:off:bypassOff",
    ]);
  });
});

describe("mode-menu: Shift+Tab", () => {
  test("goes default, accept edits, plan, and round to default", () => {
    const all = rows("default", "default", true);
    expect(nextMode(all, "default")).toBe("acceptEdits");
    expect(nextMode(all, "acceptEdits")).toBe("plan");
    expect(nextMode(all, "plan")).toBe("default");
  });

  test("never lands on bypass, and leaves it for the default", () => {
    const all = rows("bypassPermissions", "default", true);
    expect(nextMode(all, "bypassPermissions")).toBe("default");
  });

  test("skips the modes that are blocked", () => {
    const strict = rows("plan", "plan", false);
    expect(nextMode(strict, "plan")).toBeNull();
    const half = rows("default", "default", false);
    expect(nextMode(half, "default")).toBe("plan");
  });

  test("a mode outside the cycle (auto) goes to the default", () => {
    expect(nextMode(rows("auto", "auto", false), "auto" as never)).toBe("default");
  });
});
