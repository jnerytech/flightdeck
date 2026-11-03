import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const sidebar = readFileSync(join(import.meta.dir, "../src/ui/Sidebar.tsx"), "utf8");

describe("escala-de-peso: one weight scale", () => {
  test("the scale is three tokens: strong for titles and primary actions, label for filters and pills, text for the rest", () => {
    expect(css).toMatch(/--weight-strong:\s*600/);
    expect(css).toMatch(/--weight-label:\s*500/);
    expect(css).toMatch(/--weight-text:\s*400/);
  });

  test("primary buttons are strong; outline, secondary and ghost ones are label weight", () => {
    expect(css).toMatch(
      /\[data-slot="button"\]\[data-variant="default"\][^{]*\{[^}]*font-weight:\s*var\(--weight-strong\)/,
    );
    expect(css).toMatch(
      /\[data-slot="button"\]\[data-variant="outline"\][^{]*\{[^}]*font-weight:\s*var\(--weight-label\)/,
    );
  });

  test("the sidebar's items are plain text, and only the page you are on is label weight", () => {
    expect(sidebar).toMatch(/props\.active && "[^"]*font-medium/);
    expect(sidebar).toMatch(/const ITEM =\s*"[^"]*font-normal/);
  });
});
