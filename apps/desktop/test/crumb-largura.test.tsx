import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Breadcrumb } = await import("../src/components/layout/breadcrumb.tsx");

afterEach(cleanup);

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
const block = (name: string) => css.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";

/**
 * Cheap guards, not proofs: these read the class names and the CSS text, so they only say the
 * rules were not removed. The layout itself (widths, ellipsis, no sideways scroll) is measured in
 * a real browser by the e2e `layout` journey (scripts/e2e/journeys.ts); happy-dom has no layout.
 */
describe("guard: crumb-largura: the tab strip starts at the same place on every screen", () => {
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

  test("a step is cut with an ellipsis and is still a target at least 24 px high", () => {
    render(
      <Breadcrumb
        crumbs={[{ label: "Hosts", route: { name: "hub" } }, { label: "Atual" }]}
        label="Path"
        onGo={() => {}}
      />,
    );
    const step = screen.getByRole("button", { name: "Hosts" });
    const classes = step.className.split(/\s+/);
    expect(classes).toContain("truncate");
    // A block has the height of its line: 24 px of height and of line keep the text centered in it.
    expect(classes).toContain("min-h-6");
    expect(classes).toContain("leading-6");
  });

  test("the active tab's outline is drawn on the whole tab, so its close button is inside it", () => {
    const source = readFileSync(join(import.meta.dir, "../src/ui/TabBar.tsx"), "utf8");
    expect(source).toContain("has-[[role=tab]:focus-visible]:ring-2");
    expect(source).not.toMatch(/rounded-t-md px-2 py-1\.5 outline-none[^"]*focus-visible:ring-2/);
  });
});

describe("guard: crumb-largura: a long path is cut with an ellipsis, the earlier steps first (issue #133)", () => {
  const crumbs = [
    { label: "wsl - Ubuntu 24.04 on a long machine name", route: { name: "hub" as const } },
    { label: "Projects", route: { name: "hub" as const } },
    { label: "Board", route: { name: "hub" as const } },
    { label: "agent-runtime-delivery-lens" },
  ];

  test("each label is a block that truncates, with its full text as the tooltip", () => {
    render(<Breadcrumb crumbs={crumbs.slice(0, 2)} label="Path" onGo={() => {}} />);
    const first = screen.getByRole("button", { name: /wsl - Ubuntu/ });
    expect(first.className).toMatch(/\bblock\b/);
    expect(first.className).toContain("truncate");
    expect(first.getAttribute("title")).toContain("wsl - Ubuntu");
  });

  test("the earlier steps shrink first, down to 4rem, and the current one last, with factors that add up to at least 1", () => {
    render(<Breadcrumb crumbs={crumbs.slice(0, 2)} label="Path" onGo={() => {}} />);
    const [earlier, current] = [...document.querySelectorAll("nav li")] as HTMLElement[];
    // The earlier steps may go low (a 760 px window has room for little), the current one keeps a floor.
    expect(earlier?.className).toContain("min-w-[1rem]");
    expect(current?.className).toContain("min-w-[4rem]");
    /** `shrink-[N]` is N; a bare `shrink` is 1. */
    const factor = (el: HTMLElement | undefined) => {
      const match = el?.className.match(/\bshrink-\[([\d.]+)\]/);
      return match ? Number(match[1]) : /\bshrink\b/.test(el?.className ?? "") ? 1 : 0;
    };
    // Flex only shrinks by the share of the overflow that the factors add up to when they add up
    // to under 1: a current step with a fraction would stay wide and run under the bell.
    expect(factor(current)).toBeGreaterThanOrEqual(1);
    expect(factor(earlier)).toBeGreaterThan(factor(current));
  });

  test("the floors of a path that is not folded fit the narrowest crumb slot, so nothing can reach the bell", () => {
    // The slot is 40% of the narrowest window (720 px) = 288 px, less the back, forward and bell
    // buttons (36 px each) and the gaps between the four (8 px each): 288 - 108 - 24 = 156 px.
    const NAV_AT_720 = 156;
    const CHEVRON = 14 + 2 * 4; // the icon and the gap on both sides
    render(<Breadcrumb crumbs={crumbs.slice(0, 3)} label="Path" onGo={() => {}} />);
    const items = [...document.querySelectorAll("nav li")] as HTMLElement[];
    const floor = (el: HTMLElement) =>
      Number(el.className.match(/min-w-\[([\d.]+)rem\]/)?.[1] ?? 0) * 16;
    const total = items.reduce((sum, el) => sum + floor(el), 0) + (items.length - 1) * CHEVRON;
    expect(items).toHaveLength(3);
    expect(total).toBeLessThanOrEqual(NAV_AT_720);
  });

  test("a folded path reads first › menu › current, with a chevron before the menu too", () => {
    render(<Breadcrumb crumbs={crumbs} label="Path" moreLabel="More" onGo={() => {}} />);
    const parts = [...(document.querySelector("nav ol")?.children ?? [])].map((el) =>
      el.tagName.toLowerCase(),
    );
    expect(parts).toEqual(["li", "svg", "li", "svg", "li"]);
  });

  test("with many steps the middle ones collapse into a menu that goes to them", () => {
    const went: string[] = [];
    render(
      <Breadcrumb
        crumbs={crumbs}
        label="Path"
        moreLabel="Show the steps in between"
        onGo={(route) => void went.push(route.name)}
      />,
    );
    expect(screen.queryByRole("button", { name: "Projects" })).toBeNull();
    const more = screen.getByRole("button", { name: "Show the steps in between" });
    expect(more.querySelector("svg")).not.toBeNull();
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Projects", "Board"]);
    fireEvent.click(screen.getAllByRole("menuitem")[0] as HTMLElement);
    expect(went).toEqual(["hub"]);
  });
});
