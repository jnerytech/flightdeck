import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DESKTOP = resolve(import.meta.dir, "..");
const read = (file: string) => readFileSync(resolve(DESKTOP, file), "utf8");

/** The text from the first `marker` of the stylesheet to the end of its block. */
function ruleAt(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

describe("ux-basicos: click feedback", () => {
  test("clickable elements show the pointer, and a disabled one does not", () => {
    const css = read("src/styles.css");
    const clickable = ruleAt(css, "button:not(:disabled)");
    expect(clickable).toContain('[role="tab"]');
    expect(clickable).toContain("cursor: pointer");
    expect(ruleAt(css, "button:disabled")).toContain("cursor: default");
  });

  test("a pressed button moves at once, in the base layer (the vendored Button stays as generated)", () => {
    expect(ruleAt(read("src/styles.css"), "button:not(:disabled):active")).toContain(
      "transform: translateY(1px)",
    );
  });
});
