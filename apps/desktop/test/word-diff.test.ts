import { describe, expect, test } from "bun:test";
import { type WordPart, wordDiff } from "../src/lib/word-diff.ts";

const text = (parts: WordPart[], kind: WordPart["kind"]) =>
  parts
    .filter((p) => p.kind === kind)
    .map((p) => p.text)
    .join("");
const join = (parts: WordPart[]) => parts.map((p) => p.text).join("");

describe("word-diff: what changed between two texts, word by word", () => {
  test("equal texts are one unchanged part; empty against text is all added or all removed", () => {
    expect(wordDiff("same words", "same words")).toEqual([{ kind: "same", text: "same words" }]);
    expect(wordDiff("", "new text")).toEqual([{ kind: "add", text: "new text" }]);
    expect(wordDiff("old text", "")).toEqual([{ kind: "del", text: "old text" }]);
    expect(wordDiff("", "")).toEqual([]);
  });

  test("a changed word is removed and added; the words around it stay unchanged", () => {
    const parts = wordDiff("fix the totl now", "fix the total now");
    expect(parts).toEqual([
      { kind: "same", text: "fix the " },
      { kind: "del", text: "totl" },
      { kind: "add", text: "total" },
      { kind: "same", text: " now" },
    ]);
  });

  test("the parts read back as the two texts: same + del is the old one, same + add the new one", () => {
    const a = "Fix the total.\n\n- one\n- two  items\n";
    const b = "Fix the totals.\n\n- one\n- three items\n- four\n";
    const parts = wordDiff(a, b);
    expect(join(parts.filter((p) => p.kind !== "add"))).toBe(a);
    expect(join(parts.filter((p) => p.kind !== "del"))).toBe(b);
    expect(text(parts, "add")).toContain("four");
  });

  test("line breaks and spacing are part of the text and survive", () => {
    const parts = wordDiff("a\nb", "a\nc");
    expect(join(parts.filter((p) => p.kind !== "add"))).toBe("a\nb");
    expect(join(parts.filter((p) => p.kind !== "del"))).toBe("a\nc");
  });

  test("a very long text is compared in bounded time and still reads back (a coarse diff when too big)", () => {
    const a = Array.from({ length: 6000 }, (_, i) => `w${i}`).join(" ");
    const b = Array.from({ length: 6000 }, (_, i) => (i % 7 === 0 ? `x${i}` : `w${i}`)).join(" ");
    const started = Date.now();
    const parts = wordDiff(a, b);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(join(parts.filter((p) => p.kind !== "add"))).toBe(a);
    expect(join(parts.filter((p) => p.kind !== "del"))).toBe(b);
  });
});
