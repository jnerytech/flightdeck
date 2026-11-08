import { describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { memoryPlatform } from "./fixtures.ts";

const store = () => new AppStore(memoryPlatform(false, "en").platform);

describe("composer-fill-store: text handed to a session's message box (#1146)", () => {
  test("a fill waits for its session's box, which takes it once", () => {
    const s = store();
    s.fillComposer("h1/s1", "Revisão das mudanças:");
    expect(s.getState().composerFill["h1/s1"]).toBe("Revisão das mudanças:");
    expect(s.takeComposerFill("h1/s1")).toBe("Revisão das mudanças:");
    expect(s.getState().composerFill["h1/s1"]).toBeUndefined();
    expect(s.takeComposerFill("h1/s1")).toBeNull();
  });

  test("a second fill for the same session goes after the first, apart by a blank line", () => {
    const s = store();
    s.fillComposer("h1/s1", "one");
    s.fillComposer("h1/s1", "two");
    expect(s.takeComposerFill("h1/s1")).toBe("one\n\ntwo");
  });

  test("another session's fill is left alone", () => {
    const s = store();
    s.fillComposer("h1/s1", "one");
    s.fillComposer("h1/s2", "two");
    s.takeComposerFill("h1/s1");
    expect(s.getState().composerFill["h1/s2"]).toBe("two");
  });
});
