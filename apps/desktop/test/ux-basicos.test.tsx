import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Breadcrumb } = await import("../src/components/layout/breadcrumb.tsx");

afterEach(cleanup);

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

  test("the breadcrumb's steps are targets of at least 24 px high", () => {
    render(
      <Breadcrumb
        label="Caminho"
        onGo={() => {}}
        crumbs={[{ label: "Hosts", route: { name: "hub" } }, { label: "Atual" }]}
      />,
    );
    const step = screen.queryByRole("button", { name: "Hosts" });
    expect(step).not.toBeNull();
    expect(step?.className ?? "").toContain("min-h-6");
  });
});
