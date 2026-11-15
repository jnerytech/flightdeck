import { describe, expect, test } from "bun:test";
import { FIND_DECORATIONS } from "../../src/features/terminal/domain/terminal-view.ts";
import { setup, THEME } from "./xterm-setup.ts";

describe("terminal-ui: the xterm screen", () => {
  test("xterm is built with the theme, font and the four addons, with unicode 11 on", () => {
    const s = setup();
    expect(s.constructed()).toMatchObject({
      theme: THEME,
      fontSize: 13,
      fontFamily: "mono",
      cursorBlink: true,
      allowProposedApi: true,
    });
    expect(s.addons).toHaveLength(4);
    expect(s.terminal.unicode.activeVersion).toBe("11");
  });

  // Issue #476: xterm's default of 1,000 lines lost the start of a long Claude turn from the view
  // and from find, though the daemon still had it. Windows Terminal keeps 9,001.
  test("the view keeps 10,000 lines of scrollback", () => {
    expect(setup().constructed().scrollback).toBe(10_000);
  });

  test("output and resets go to xterm; opening fits it and gives it the focus", () => {
    const s = setup();
    s.screen.write(new TextEncoder().encode("hi"));
    s.screen.reset();
    s.screen.open({} as HTMLElement);
    s.screen.focus();
    expect(s.log).toEqual(["write:hi", "reset", "open", "fit", "focus"]);
  });

  test("a write is reported as drawn when xterm's own callback runs, not before", () => {
    const s = setup();
    let drawn = 0;
    s.screen.write(new TextEncoder().encode("hi"), () => void drawn++);
    expect(drawn).toBe(0);
    s.drawAll();
    expect(drawn).toBe(1);
  });

  test("keys typed and sizes changed are reported", () => {
    const s = setup();
    s.typed("ls\r");
    s.resized(100, 30);
    expect(s.inputs).toEqual(["ls\r"]);
    expect(s.resizes).toEqual([[100, 30]]);
  });

  test("Ctrl+Shift+C copies the selection and is kept from the process; with no selection it does nothing", async () => {
    const withSelection = setup("abc");
    expect(withSelection.press("C")).toBe(false);
    await Promise.resolve();
    expect(withSelection.clip).toEqual(["copy:abc"]);
    const without = setup("");
    expect(without.press("C")).toBe(false);
    await Promise.resolve();
    expect(without.clip).toEqual([]);
  });

  test("a selection the program's redraw took away can still be copied: the last one is kept until the person types", async () => {
    const s = setup();
    s.select("abc");
    s.lose();
    expect(s.screen.hasSelection()).toBe(true);
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:abc"]);
    expect(s.press("C")).toBe(false);
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:abc", "copy:abc"]);
    s.typed("l");
    expect(s.screen.hasSelection()).toBe(false);
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toHaveLength(2);
    expect(s.inputs).toEqual(["l"]);
  });

  test("a new selection replaces the kept one, and the live one wins over it", async () => {
    const s = setup();
    s.select("old");
    s.select("new");
    s.lose();
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:new"]);
    s.select("live");
    s.screen.copy();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:new", "copy:live"]);
  });

  test("on Windows Ctrl+C copies when there is a selection and goes to the process (SIGINT) when there is none", async () => {
    const withSelection = setup("abc", false, true);
    expect(withSelection.press("c", true, false)).toBe(false);
    await Promise.resolve();
    expect(withSelection.clip).toEqual(["copy:abc"]);
    const without = setup("", false, true);
    expect(without.press("c", true, false)).toBe(true);
    await Promise.resolve();
    expect(without.clip).toEqual([]);
  });

  test("off Windows Ctrl+C always goes to the process, even over a selection", async () => {
    const s = setup("abc", false, false);
    expect(s.press("c", true, false)).toBe(true);
    await Promise.resolve();
    expect(s.clip).toEqual([]);
  });

  test("dispose releases the listeners and xterm", () => {
    const s = setup();
    s.screen.dispose();
    expect(s.log).toEqual(["off-selection", "off-data", "off-resize", "off-paths", "dispose"]);
  });

  test("a clipboard that refuses to copy or to be read leaves the terminal as it was", async () => {
    const s = setup("abc", true);
    expect(s.press("C")).toBe(false);
    expect(s.press("V")).toBe(false);
    await Bun.sleep(5);
    expect(s.log).toEqual([]);
  });

  test("copy and paste are there for a menu too, and a clicked link goes to onLink", async () => {
    const s = setup("sel");
    s.screen.copy();
    s.screen.paste();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.clip).toEqual(["copy:sel"]);
    expect(s.log).toContain("paste:pasted");
    s.links[0]?.("https://example.com");
    expect(s.linked).toEqual(["https://example.com"]);
  });

  test("find passes match case, whole word and regex on; a pattern it cannot search clears instead (issue #476)", () => {
    const s = setup();
    s.screen.find("Hit", "next", false, { caseSensitive: true, wholeWord: true });
    expect(s.findOptions.at(-1)).toMatchObject({ caseSensitive: true, wholeWord: true });
    expect(s.screen.find("a(", "next", true, { regex: true })).toBe(false);
    expect(s.screen.find("a*", "previous", false, { regex: true })).toBe(false);
    expect(s.log.filter((line) => /^(next|prev|clear)/.test(line))).toEqual([
      "next:Hit",
      "clear",
      "clear",
    ]);
  });

  test("find highlights every match and marks the current one; typing keeps the match", () => {
    const s = setup();
    s.screen.find("hit", "next");
    s.screen.find("hit", "previous");
    s.screen.find("hi", "next", true);
    expect(s.findOptions).toEqual([
      { incremental: false, decorations: FIND_DECORATIONS },
      { incremental: false, decorations: FIND_DECORATIONS },
      { incremental: true, decorations: FIND_DECORATIONS },
    ]);
    const colors = Object.values(FIND_DECORATIONS);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    expect(FIND_DECORATIONS.matchBackground).toBeDefined();
    expect(FIND_DECORATIONS.activeMatchBackground).toBeDefined();
    expect(FIND_DECORATIONS.activeMatchBackground).not.toBe(FIND_DECORATIONS.matchBackground);
  });

  test("the position among the matches is reported, and its listener is released on dispose", () => {
    const s = setup();
    s.announce(1, 5);
    expect(s.found).toEqual([{ resultIndex: 1, resultCount: 5 }]);
    s.screen.dispose();
    expect(s.searchOff).toEqual([1]);
  });

  test("select all and the selection state are there for the menu", () => {
    const s = setup("abc");
    expect(s.screen.hasSelection()).toBe(true);
    s.screen.selectAll();
    expect(s.log).toContain("select-all");
    expect(setup().screen.hasSelection()).toBe(false);
  });
});
