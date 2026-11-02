import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");

/** The value of a token inside the first `selector { … }` block. */
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? "";
}

describe("movimento-tokens", () => {
  test(":root carries the motion tokens with the same values as the theme's", () => {
    expect(token(":root", "--motion-fast")).toBe(token("@theme inline", "--duration-fast"));
    expect(token(":root", "--motion-base")).toBe(token("@theme inline", "--duration-base"));
    expect(token(":root", "--motion-ease")).toBe(token("@theme inline", "--ease-out-soft"));
    expect(token(":root", "--motion-fast")).toBe("120ms");
  });

  test("controls, rows and menu items ease their colours with them", () => {
    const rule = /(button:not\(:disabled\)[^{]*)\{([^}]*)\}/g;
    const bodies = [...css.matchAll(rule)].map((m) => m[2] as string);
    const eased = bodies.find((b) => b.includes("transition-duration: var(--motion-fast)"));
    expect(eased).toBeDefined();
    expect(eased).toContain("transition-timing-function: var(--motion-ease)");
    expect(eased).toContain("transition-property: color, background-color, border-color");
  });

  test("the reduced-motion block still zeroes every duration", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*0\.01ms !important/s,
    );
  });
});
