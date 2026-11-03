import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("dialogo-centro: a dialog sits centered over a dimmed page", () => {
  test("it is centered by its own margins (no transform that a webview can drop), outside the vendored component", () => {
    const content = rule('[data-slot="dialog-content"]');
    expect(content).toContain("inset: 0");
    expect(content).toContain("margin: auto");
    expect(content).toContain("translate: none");
    expect(content).toContain("height: fit-content");
    expect(content).toContain("overflow-y: auto");
  });

  test("the overlay dims the page more and blurs it a little", () => {
    const overlay = rule('[data-slot="dialog-overlay"]');
    expect(overlay).toContain("background-color: oklch(0 0 0 / 60%)");
    expect(overlay).toContain("backdrop-filter: blur(1px)");
  });
});
