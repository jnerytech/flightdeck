import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIUM_QUERY } from "../src/hooks/use-breakpoint.ts";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const block = (name: string) =>
  css.match(new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

/**
 * Cheap guards, not proofs: they read the stylesheet's text. The widths themselves are measured by
 * the e2e `layout` journey. Here they only say the top bar and the status bar change at the same
 * widths as `useBreakpoint()` (issue #641), not at an older 960 px of their own.
 */
describe("guard: shell-breakpoint-css: the narrow shell rules follow the 1024 px breakpoint", () => {
  test("the hook's medium query is the one the stylesheet repeats", () => {
    expect(MEDIUM_QUERY).toBe("(width < 1024px)");
  });

  test("no rule keys on the old 960 px width", () => {
    const old = css.match(/max-width:\s*959px/g)?.length ?? 0;
    expect(old).toBe(0);
  });

  test.each([
    "header-crumbs",
    "top-bar-host",
    "top-bar-host-name",
    "top-bar-host-chevron",
    "top-bar-host-icon",
    "status-quota-window",
    "top-bar-search",
    "top-bar-search-text",
    "top-bar-search-keys",
    "top-bar-version",
  ])("%s changes below 1024 px", (name) => {
    expect(block(name)).toContain(`@media ${MEDIUM_QUERY}`);
  });
});
