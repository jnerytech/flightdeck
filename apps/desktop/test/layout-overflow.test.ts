import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(import.meta.dir, "../src", file), "utf8");

describe("layout-overflow: the window never scrolls sideways (issue #103)", () => {
  test("the shell's single column is a track that can shrink, so 12 tabs cannot widen the page", () => {
    const shell = read("components/layout/app-shell.tsx");
    // An implicit `auto` column grows to the header's min-content, and the tab strip is in it.
    expect(shell).toContain("grid-cols-[minmax(0,1fr)]");
    expect(shell).toMatch(/<header className="[^"]*\bmin-w-0\b/);
  });
});
