import { describe, expect, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import { setup, THEME } from "./xterm-setup.ts";

describe("terminal-ui: xterm keys and links", () => {
  test("Shift+Enter alone sends the newline Claude Code reads (ESC then CR) once, and plain Enter is left to xterm", () => {
    const s = setup();
    const key = (type: string, over: Partial<KeyboardEvent> = {}) =>
      ({
        key: "Enter",
        type,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        ...over,
      }) as KeyboardEvent;
    // xterm asks about keydown, keypress and keyup: only the keydown sends, and none of them reaches xterm's own CR.
    expect(s.keys(key("keydown"))).toBe(false);
    expect(s.keys(key("keypress"))).toBe(false);
    expect(s.keys(key("keyup"))).toBe(false);
    expect(s.inputs).toEqual(["\u001b\r"]);
    // Enter alone, and Shift+Enter with another modifier, are not this.
    expect(s.keys(key("keydown", { shiftKey: false }))).toBe(true);
    expect(s.keys(key("keydown", { ctrlKey: true }))).toBe(true);
    expect(s.keys(key("keydown", { altKey: true }))).toBe(true);
    expect(s.keys(key("keydown", { metaKey: true }))).toBe(true);
    expect(s.inputs).toEqual(["\u001b\r"]);
  });

  test("Ctrl+=, Ctrl+- and Ctrl+0 zoom once per press, kept from the process and from the page's own zoom (issue #476)", () => {
    const s = setup();
    let prevented = 0;
    const key = (k: string, type = "keydown") =>
      ({
        key: k,
        type,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: () => void prevented++,
      }) as unknown as KeyboardEvent;
    expect(s.keys(key("="))).toBe(false);
    expect(s.keys(key("=", "keyup"))).toBe(false);
    expect(s.keys(key("-"))).toBe(false);
    expect(s.keys(key("0"))).toBe(false);
    expect([s.zooms, prevented, s.inputs]).toEqual([["zoomIn", "zoomOut", "zoomReset"], 4, []]);
  });

  test("Ctrl+wheel zooms and keeps the page from zooming; the wheel alone stays xterm's scroll (issue #476)", () => {
    const s = setup();
    let prevented = 0;
    const wheel = (ctrlKey: boolean, deltaY: number) =>
      ({ ctrlKey, deltaY, preventDefault: () => void prevented++ }) as unknown as WheelEvent;
    expect(s.wheel(wheel(true, -100))).toBe(false);
    expect(s.wheel(wheel(true, 100))).toBe(false);
    expect(s.wheel(wheel(false, 100))).toBe(true);
    expect([s.zooms, prevented]).toEqual([["zoomIn", "zoomOut"], 2]);
  });

  test("Ctrl+Shift+V pastes the clipboard through xterm; Ctrl+Shift+F asks for the search; the rest passes", async () => {
    const s = setup();
    expect(s.press("V")).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.log).toContain("paste:pasted");
    expect(s.press("F")).toBe(false);
    expect(s.searches()).toBe(1);
    expect(s.press("c", true, false)).toBe(true);
    expect(s.press("a", false, false)).toBe(true);
  });

  test("theme and font changes apply and refit; find goes next or previous and clears", () => {
    const s = setup();
    s.screen.setTheme({ ...THEME, background: "#ffffff" });
    s.screen.setFontSize(16);
    expect(s.terminal.options.theme?.background).toBe("#ffffff");
    expect(s.terminal.options.fontSize).toBe(16);
    expect(s.log.filter((entry) => entry === "fit")).toHaveLength(1);
    expect(s.screen.find("hit", "next")).toBe(true);
    expect(s.screen.find("miss", "next")).toBe(false);
    expect(s.screen.find("x", "previous")).toBe(true);
    s.screen.clearFind();
    expect(s.log.slice(-4)).toEqual(["next:hit", "next:miss", "prev:x", "clear"]);
  });

  test("a file path in the output is a link over its own cells; clicking it hands the path on (issue #476)", async () => {
    const s = setup();
    s.showLines("nothing here", "see src/a.ts:3 now");
    expect(await s.linksOn(1)).toBeUndefined();
    const links = await s.linksOn(2);
    expect(links?.map((link) => [link.text, link.range])).toEqual([
      ["src/a.ts:3", { start: { x: 5, y: 2 }, end: { x: 14, y: 2 } }],
    ]);
    links?.[0]?.activate({} as MouseEvent, "src/a.ts:3");
    expect(s.paths).toEqual([["src/a.ts", { line: 3 }]]);
  });

  test("a path printed without a line hands on no position (#506)", async () => {
    const s = setup();
    s.showLines("wrote ./notes/b.md:4:2 and /x/y.md");
    for (const link of (await s.linksOn(1)) ?? []) link.activate({} as MouseEvent, link.text);
    expect(s.paths).toEqual([
      ["./notes/b.md", { line: 4, col: 2 }],
      ["/x/y.md", undefined],
    ]);
  });

  test("on a row with wide characters the link still sits over the path's own cells (issue #476)", async () => {
    const s = setup();
    s.showLines("⏺ src/a.ts");
    const links = await s.linksOn(1);
    expect(links?.map((link) => link.range)).toEqual([
      { start: { x: 4, y: 1 }, end: { x: 11, y: 1 } },
    ]);
  });

  test("a paste of several lines waits for the OK unless the program turned on bracketed paste (issue #476)", async () => {
    const asked: string[] = [];
    const answers = [false, true];
    const confirm = async (text: string) => {
      asked.push(text);
      return answers.shift() ?? false;
    };
    const s = setup("", false, false, { clip: "a\nb", confirm });
    s.screen.paste();
    await settleMaybe(() => asked.length === 1);
    s.screen.paste();
    await settleMaybe(() => s.log.includes("paste:a\nb"));
    expect([asked, s.log.filter((line) => line.startsWith("paste:"))]).toEqual([
      ["a\nb", "a\nb"],
      ["paste:a\nb"],
    ]);
    const marked = setup("", false, false, { clip: "a\nb", bracketed: true, confirm });
    marked.screen.paste();
    await settleMaybe(() => marked.log.includes("paste:a\nb"));
    expect([asked.length, marked.log.includes("paste:a\nb")]).toEqual([2, true]);
  });

  test("screen reader mode is given to xterm at the start and follows the setting (issue #476)", () => {
    const s = setup();
    expect(s.constructed().screenReaderMode).toBe(false);
    s.screen.setScreenReader(true);
    expect(s.terminal.options.screenReaderMode).toBe(true);
    s.screen.setScreenReader(false);
    expect(s.terminal.options.screenReaderMode).toBe(false);
  });
});
