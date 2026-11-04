import { describe, expect, test } from "bun:test";
import { uniqueKeys } from "../src/lib/unique-keys.ts";
import { sameKeyWarnings } from "./dom.ts";

describe("unique-keys: a key per row, even when two rows are the same session", () => {
  test("the first of a repeated id keeps it, later ones get a count, and the order does not matter", () => {
    expect(uniqueKeys(["usage-004", "usage-001", "usage-004", "usage-004"])).toEqual([
      "usage-004",
      "usage-001",
      "usage-004#2",
      "usage-004#3",
    ]);
    expect(new Set(uniqueKeys(["a", "a", "a#2"])).size).toBe(3);
    expect(uniqueKeys([])).toEqual([]);
  });
});

describe("same-key-guard: what counts as React's repeated-key warning", () => {
  test("only that warning is picked out of what the console printed", () => {
    const lines = [
      "Encountered two children with the same key, `usage-004`. Keys should be unique",
      "Warning: something else entirely",
    ];
    expect(sameKeyWarnings(lines)).toEqual([lines[0] as string]);
    expect(sameKeyWarnings(["nothing"])).toEqual([]);
  });
});
