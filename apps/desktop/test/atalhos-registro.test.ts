import { describe, expect, test } from "bun:test";
import {
  CHORD_TIMEOUT_MS,
  type ChordState,
  chordStep,
  isMac,
  type KeyLike,
  keysLabel,
  NO_CHORD,
  SHORTCUTS,
  type ShortcutAction,
  shortcutOf,
} from "../src/lib/shortcuts.ts";

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  typing: false,
  ...extra,
});

const ACTIONS: ShortcutAction[] = [
  "palette",
  "help",
  "back",
  "forward",
  "next-client",
  "go-sessions",
  "go-needs-you",
  "go-projects",
  "go-costs",
  "go-settings",
];

describe("atalhos-registro: the registry", () => {
  test("every id is unique, every action has one shortcut, and every shortcut has keys", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of ACTIONS) {
      expect(SHORTCUTS.filter((s) => s.action === action).length).toBe(1);
    }
    expect(SHORTCUTS.every((s) => s.keys.length > 0)).toBe(true);
  });

  test("the go-to chords are a letter then a letter", () => {
    const chords = ACTIONS.filter((a) => a.startsWith("go-")).map((a) => shortcutOf(a));
    expect(chords.map((c) => c?.keys)).toEqual([
      ["g", "s"],
      ["g", "n"],
      ["g", "p"],
      ["g", "c"],
      ["g", ","],
    ]);
    expect(chords.every((c) => c?.chord === true)).toBe(true);
  });

  test("the labels read for the platform: Ctrl or ⌘, + between keys, a space in a chord", () => {
    const palette = shortcutOf("palette");
    expect(palette && keysLabel(palette, false)).toBe("Ctrl+K");
    expect(palette && keysLabel(palette, true)).toBe("⌘K");
    const next = shortcutOf("next-client");
    expect(next && keysLabel(next, false)).toBe("Alt+Shift+C");
    const projects = shortcutOf("go-projects");
    expect(projects && keysLabel(projects, false)).toBe("g p");
    const help = shortcutOf("help");
    expect(help && keysLabel(help, false)).toBe("?");
  });

  test("the shortcuts the screens handle themselves are listed too, without an action", () => {
    const own = SHORTCUTS.filter((s) => s.action === undefined).map((s) => s.id);
    expect(own).toEqual(expect.arrayContaining(["list-next", "list-previous", "approve", "deny"]));
  });
});

describe("atalhos-registro: the chords", () => {
  test("g then a letter runs the go-to; the first key is consumed, the second too", () => {
    const first = chordStep(NO_CHORD, key("g"), 1000);
    expect(first).toEqual({ state: { pending: "g", at: 1000 }, action: null, consumed: true });
    const second = chordStep(first.state, key("s"), 1200);
    expect(second).toEqual({ state: NO_CHORD, action: "go-sessions", consumed: true });
    expect(chordStep({ pending: "g", at: 0 }, key("n"), 10).action).toBe("go-needs-you");
    expect(chordStep({ pending: "g", at: 0 }, key("c"), 10).action).toBe("go-costs");
    expect(chordStep({ pending: "g", at: 0 }, key(","), 10).action).toBe("go-settings");
  });

  test("an unknown second key cancels the chord and is left to the page", () => {
    expect(chordStep({ pending: "g", at: 0 }, key("x"), 10)).toEqual({
      state: NO_CHORD,
      action: null,
      consumed: false,
    });
  });

  test("a second key after the timeout is not a chord", () => {
    const late = chordStep({ pending: "g", at: 0 }, key("s"), CHORD_TIMEOUT_MS + 1);
    expect(late).toEqual({ state: NO_CHORD, action: null, consumed: false });
    const inTime = chordStep({ pending: "g", at: 0 }, key("s"), CHORD_TIMEOUT_MS);
    expect(inTime.action).toBe("go-sessions");
  });

  test("g again starts over, Shift alone keeps the chord, Escape drops it", () => {
    const again = chordStep({ pending: "g", at: 0 }, key("g"), 500);
    expect(again.state).toEqual({ pending: "g", at: 500 });
    const shift = chordStep({ pending: "g", at: 0 }, key("Shift"), 500);
    expect(shift).toEqual({ state: { pending: "g", at: 0 }, action: null, consumed: false });
    expect(chordStep({ pending: "g", at: 0 }, key("Escape"), 500).state).toEqual(NO_CHORD);
  });

  test("? opens the sheet; nothing fires while typing or with Ctrl, ⌘ or Alt held", () => {
    expect(chordStep(NO_CHORD, key("?"), 0)).toEqual({
      state: NO_CHORD,
      action: "help",
      consumed: true,
    });
    const typing: ChordState = { pending: "g", at: 0 };
    expect(chordStep(typing, key("s", { typing: true }), 1)).toEqual({
      state: NO_CHORD,
      action: null,
      consumed: false,
    });
    expect(chordStep(NO_CHORD, key("?", { typing: true }), 0).action).toBeNull();
    expect(chordStep(NO_CHORD, key("g", { ctrlKey: true }), 0).consumed).toBe(false);
    expect(chordStep(NO_CHORD, key("g", { metaKey: true }), 0).state).toEqual(NO_CHORD);
    expect(chordStep(NO_CHORD, key("g", { altKey: true }), 0).state).toEqual(NO_CHORD);
  });
});

describe("atalhos-registro: the platform", () => {
  test("a Mac is told by its platform name; anything else, or nothing, is not", () => {
    expect(isMac({ platform: "MacIntel" })).toBe(true);
    expect(isMac({ platform: "Win32" })).toBe(false);
    expect(isMac({})).toBe(false);
    expect(isMac(undefined)).toBe(false);
  });
});
