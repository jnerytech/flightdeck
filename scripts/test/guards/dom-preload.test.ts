import { describe, expect, test } from "bun:test";

/**
 * #2006: the preload registers happy-dom for every run, because `bun test` shows the preload only
 * the first path of its arguments: a shard that starts with a daemon file still holds UI files, and
 * the first of them used to load Radix with no `document` and find its menus dead. These files are
 * no desktop tests, and they start with a DOM all the same, with Bun's own networking, timers and
 * Date (the in-process daemons and the tests that control time need them).
 */
const BUN_NATIVE = [
  "WebSocket",
  "Request",
  "Response",
  "Headers",
  "AbortController",
  "AbortSignal",
  "Blob",
  "File",
  "FormData",
  "URL",
  "TransformStream",
  "WritableStream",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "Date",
] as const;

describe("dom preload: every run starts with a DOM, and Bun's globals stay Bun's", () => {
  test("a script test finds document and window", () => {
    expect([typeof document, typeof window]).toEqual(["object", "object"]);
  });

  test("the networking classes, the timers and Date are the runtime's own, not happy-dom's", () => {
    const g = globalThis as Record<string, unknown>;
    const replaced = BUN_NATIVE.filter((name) => !String(g[name]).includes("[native code]"));
    expect(replaced).toEqual([]);
    expect(typeof Bun.serve).toBe("function");
  });

  test("fetch is still the network guard's, not happy-dom's", () => {
    expect(String(globalThis.fetch)).toContain("trava de rede");
  });
});
