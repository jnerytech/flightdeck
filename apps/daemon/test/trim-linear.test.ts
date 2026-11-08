import { describe, expect, test } from "bun:test";
import { azText, sanitizeAzArgs } from "../src/board/az-text.ts";
import { stripRemote } from "../src/central/project-key.ts";
import { projectName } from "../src/names/format.ts";
import { trimEndOf, trimStartOf } from "../src/trim.ts";

/**
 * Issue #363 (Sonar S8786): text cut at its end or at its line breaks (a remote, a folder, a card's
 * text) is read in one pass. Each has its answers pinned and a worst-case input that must be read
 * in a moment: with the regex it had, the time grew with the square of the length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("trim-linear: projectName (the end of a project's key or folder)", () => {
  test.each([
    ["github.com/acme/app/", "app"],
    ["C:\\work\\app\\\\", "app"],
    [" /a/b/ ", "b"],
    ["app", "app"],
    ["a/b\\", "b"],
    ["", "sem-projeto"],
    ["///", "sem-projeto"],
    ["\\\\", "sem-projeto"],
  ])("%j gives %j", (key, expected) => {
    expect(projectName(key)).toBe(expected);
  });

  test("a long run of separators is read in a moment", () => {
    expect(took(() => projectName(`${"/".repeat(60_000)}a`))).toBeLessThan(FAST_MS);
    expect(took(() => projectName(`a${"\\/".repeat(30_000)}b`))).toBeLessThan(FAST_MS);
  });
});

describe("trim-linear: stripRemote (a git remote as host/path)", () => {
  test.each([
    ["https://github.com/acme/app.git/", "github.com/acme/app"],
    ["git@github.com:acme/app.git", "github.com/acme/app"],
    ["https://x/y///", "x/y"],
    ["https://x/y.GIT", "x/y"],
    ["ssh://git@h:22/a/b/", "h/a/b"],
    ["x//", "x"],
    ["/", ""],
    ["", ""],
  ])("%j gives %j", (url, expected) => {
    expect(stripRemote(url)).toBe(expected);
  });

  test("a long run of slashes is read in a moment", () => {
    expect(took(() => stripRemote(`https://h/${"/".repeat(60_000)}a`))).toBeLessThan(FAST_MS);
  });
});

describe("trim-linear: azText and the --wiql line (a card's text made one safe line)", () => {
  test.each([
    ["a \r\n  b", "a — b"],
    ["a\n\n\nb", "a — b"],
    ["a  b", "a b"],
    ["a\u2028b", "a b"],
    ["\n a \r b \n", "a — b"],
    ["x\r", "x"],
    ["=@f\nb", "= @f — b"],
  ])("%j gives %j", (text, expected) => {
    expect(azText(text, 60)).toBe(expected);
  });

  test("a --wiql loses its line breaks and nothing else", () => {
    expect(sanitizeAzArgs(["--wiql", "a \n  b\r\nc", "--other", "k  \n j"])).toEqual([
      "--wiql",
      "a b c",
      "--other",
      "k  \n j",
    ]);
  });

  test("a long run of spaces before a line break is read in a moment", () => {
    const text = `${" ".repeat(60_000)}a`;
    expect(took(() => azText(text, 60))).toBeLessThan(FAST_MS);
    expect(took(() => sanitizeAzArgs(["--wiql", text]))).toBeLessThan(FAST_MS);
  });
});

describe("trim-linear: trimStartOf and trimEndOf (the helper the cuts above and the rule words use)", () => {
  test.each([
    ["//a//", "/", "a//", "//a"],
    ["\"'a'\"", "\"'", "a'\"", "\"'a"],
    ["abc", "/", "abc", "abc"],
    ["///", "/", "", ""],
    ["", "/", "", ""],
    ["a/b", "/", "a/b", "a/b"],
  ])("%j without %j at its start is %j and at its end is %j", (text, chars, start, end) => {
    expect(trimStartOf(text, chars)).toBe(start);
    expect(trimEndOf(text, chars)).toBe(end);
  });

  test("a long run is cut in a moment", () => {
    const text = `${"/".repeat(120_000)}a${"/".repeat(120_000)}`;
    expect(took(() => trimStartOf(text, "/"))).toBeLessThan(FAST_MS);
    expect(took(() => trimEndOf(text, "/"))).toBeLessThan(FAST_MS);
  });
});
