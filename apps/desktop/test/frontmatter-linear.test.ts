import { describe, expect, test } from "bun:test";
import { getField, parseDocument, serialize } from "../src/lib/frontmatter.ts";

/**
 * Issue #363 (Sonar S8786): the `key: value` line of an agent or skill file is read in one pass.
 * The file is the person's own (or a plugin's), so its length is not bounded: with the regex the
 * line had, a long run of spaces before a line break the pattern does not take cost time that
 * grew with the square of the length.
 */
const FAST_MS = 1500;
const took = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};
const block = (line: string) => `---\n${line}\n---\nbody\n`;

describe("frontmatter-linear: the key line", () => {
  test.each([
    ["k: v", "k", "v"],
    ["k:\tv", "k", "v"],
    ["k:    spaced out", "k", "spaced out"],
    ["_k-1: v", "_k-1", "v"],
    ["Key9: a: b", "Key9", "a: b"],
    ["k: 'q'", "k", "q"],
    ['k: "a\\nb"', "k", "a\nb"],
    ["k: trailing  ", "k", "trailing  "],
    ["k: \u00a0nbsp first", "k", "\u00a0nbsp first"],
  ])("%j is the field %j = %j", (line, key, value) => {
    const doc = parseDocument(block(line));
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]).toMatchObject({ key });
    expect(getField(doc, key)).toBe(value);
  });

  test.each([["k:"], ["k:   "], ["k: \t"]])(
    "%j has no value, so it is kept as a complex line",
    (line) => {
      const doc = parseDocument(block(line));
      expect(doc.entries).toEqual([{ key: "k", value: "", raw: line, complex: true }]);
      expect(getField(doc, "k")).toBeUndefined();
    },
  );

  test.each([
    ["k:v"],
    ["k :v"],
    ["k : v"],
    [": v"],
    [""],
    ["a b: c"],
    ["ké: v"],
    ["# k: v"],
    ["k: a\rb"],
    ["k: a\u2028b"],
    ["k: a\u2029b"],
    ["k:  \u2028"],
  ])("%j is not a field", (line) => {
    expect(parseDocument(block(line)).entries).toEqual([]);
  });

  test("a field is written back as it was read", () => {
    const text = "---\nname: x\nkey:   spaced\n---\nbody\n";
    expect(serialize(parseDocument(text))).toBe(text.replace("key:   spaced", "key: spaced"));
  });

  test("a long run of spaces before a line break the key line does not take is read in a moment", () => {
    for (const end of ["\u2028", "\u2029", "\rx"]) {
      const text = block(`k:${" ".repeat(30_000)}${end}`);
      expect(took(() => parseDocument(text))).toBeLessThan(FAST_MS);
    }
  });

  test("a long key, a long value and a long run of tabs are read in a moment", () => {
    expect(took(() => parseDocument(block(`${"a".repeat(120_000)}x`)))).toBeLessThan(FAST_MS);
    expect(took(() => parseDocument(block(`k: ${"v".repeat(120_000)}`)))).toBeLessThan(FAST_MS);
    expect(took(() => parseDocument(block(`k:${"\t".repeat(30_000)}\u2028`)))).toBeLessThan(
      FAST_MS,
    );
  });
});
