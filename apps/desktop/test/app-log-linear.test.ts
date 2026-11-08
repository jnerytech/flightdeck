import { describe, expect, test } from "bun:test";
import { reactErrorLine } from "../src/lib/app-log.ts";

/**
 * Issue #363 (Sonar S8786): the frames of an error's stack are read in one pass. A stack is text
 * the engine builds from the error's message, and a message can be anything a server said, so a
 * line of it may be as long as it likes: with the regex the V8 frame line had, a long run of white
 * space made the time grow with the cube of the length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

/** The frames part of the line `reactErrorLine` writes for an error whose stack is `stack`. */
function framesOf(stack: string): string {
  const error = new Error("boom");
  error.stack = stack;
  const line = reactErrorLine(error, {}, "home");
  return line.split(" | ").find((part) => part.startsWith("frames: ")) ?? "";
}

describe("app-log-linear: the V8 frame line", () => {
  test.each([
    ["    at Wi (https://host/assets/index.js:40:1200)", "frames: Wi (assets/index.js:40:1200)"],
    ["at Wi (assets/index.js:40:1)", "frames: Wi (assets/index.js:40:1)"],
    [
      "    at https://host/assets/index.js:40:1200",
      "frames: <anonymous> (assets/index.js:40:1200)",
    ],
    ["at\tWi\t(a.js:1:1)", "frames: Wi (a.js:1:1)"],
    ["at x ( y )", "frames: x ( y )"],
    ["at x (y) ", "frames: x (y)"],
    ["at x (  ", "frames: x ( )"],
    ["at  )", "frames: <anonymous> ( )"],
    ["at   ", "frames: <anonymous> ( )"],
    ["at \t)  ", "frames: <anonymous> (\t)"],
    ["at x (a ) ", "frames: x (a )"],
    ["at x (y)   ", "frames: x (y)"],
    ["at some thing here", "frames: <anonymous> (some thing here)"],
    ["at a:1:2   ", "frames: <anonymous> (a:1:2)"],
  ])("%j gives %j", (line, expected) => {
    expect(framesOf(line)).toBe(expected);
  });

  test.each([
    ["at"],
    ["at "],
    ["attach x"],
    ["Error: at x (a.js:1:1)"],
    ["at x (a(b)"],
    ["at x (a))"],
    ["at x ()"],
    ["  at async run (file.js:3:4)"],
    ["at new Foo (a.js:1:1)"],
    ["at (a:1:1)"],
    ["at ()"],
    ["at )"],
    ["at a)b"],
    ["at x (a) b"],
    [""],
  ])("%j is not a frame", (line) => {
    expect(framesOf(line)).toBe("");
  });

  test("a JavaScriptCore frame is read, and the lines are kept in order", () => {
    const stack = ["Error: boom", "Wi@https://host/assets/index.js:40:1200", "    at A (a.js:1:1)"];
    expect(framesOf(stack.join("\n"))).toBe("frames: Wi (assets/index.js:40:1200) < A (a.js:1:1)");
  });

  test("only the first six frames are kept", () => {
    const stack = Array.from({ length: 9 }, (_, i) => `at f${i} (a.js:${i}:1)`).join("\n");
    expect(framesOf(stack).split(" < ")).toHaveLength(6);
  });

  test("a long run of white space in a frame line is read in a moment", () => {
    for (const stack of [
      `at ${" ".repeat(1500)}()`,
      `at a${" ".repeat(1500)}()`,
      `at x (${" ".repeat(1500)}()`,
      `${" ".repeat(60_000)}at`,
      `at ${"a ".repeat(30_000)}(`,
    ]) {
      expect(took(() => framesOf(stack))).toBeLessThan(FAST_MS);
    }
  });

  test("many long lines are read in a moment", () => {
    const stack = Array.from({ length: 20 }, () => `at ${" ".repeat(800)}()`).join("\n");
    expect(took(() => framesOf(stack))).toBeLessThan(FAST_MS);
  });
});
