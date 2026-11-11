import { describe, expect, test } from "bun:test";

/**
 * #2006: the preload registers happy-dom for every run, because `bun test` shows the preload only
 * the first path of its arguments: a shard that starts with a daemon file still holds UI files, and
 * the first of them used to load Radix with no `document` and find its menus dead. This file is no
 * desktop test, and it starts with a DOM all the same.
 */
describe("dom preload: every run starts with a DOM", () => {
  test("a script test finds document and window, and Bun's server and WebSocket are still Bun's", () => {
    expect([typeof document, typeof window]).toEqual(["object", "object"]);
    expect(typeof Bun.serve).toBe("function");
    expect(String(globalThis.WebSocket)).toContain("native code");
  });
});
