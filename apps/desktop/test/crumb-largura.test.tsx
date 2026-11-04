import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Breadcrumb } = await import("../src/components/layout/breadcrumb.tsx");

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const block = (name: string) => css.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";

describe("crumb-largura: the tab strip starts at the same place on every screen", () => {
  test("the crumb slot has a width of its own that neither the crumbs nor the window's slack change", () => {
    const slot = block("header-crumbs");
    expect(slot).toMatch(/flex:\s*0 0 24rem/);
    expect(slot).not.toMatch(/flex:\s*0 1 auto/);
  });

  test("a long last crumb is cut with an ellipsis and says its full text in a tooltip", () => {
    render(
      <Breadcrumb
        crumbs={[
          { label: "Hosts", route: { name: "hub" } },
          { label: "A host with a very long name indeed" },
        ]}
        label="Path"
        onGo={() => {}}
      />,
    );
    const last = screen.getByText("A host with a very long name indeed");
    expect(last.className).toContain("truncate");
    expect(last.getAttribute("title")).toBe("A host with a very long name indeed");
    expect(screen.getByRole("button", { name: "Hosts" }).getAttribute("title")).toBe("Hosts");
  });

  test("the active tab's outline is drawn on the whole tab, so its close button is inside it", () => {
    const source = readFileSync(join(import.meta.dir, "../src/ui/TabBar.tsx"), "utf8");
    expect(source).toContain("has-[[role=tab]:focus-visible]:ring-2");
    expect(source).not.toMatch(/rounded-t-md px-2 py-1\.5 outline-none[^"]*focus-visible:ring-2/);
  });
});
