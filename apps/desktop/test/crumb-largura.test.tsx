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

describe("crumb-largura: a long path is cut with an ellipsis, the earlier steps first (issue #133)", () => {
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

  test("the earlier steps shrink first, down to 4rem, and the current one last", () => {
    render(<Breadcrumb crumbs={crumbs.slice(0, 2)} label="Path" onGo={() => {}} />);
    const [earlier, current] = [...document.querySelectorAll("nav li")] as HTMLElement[];
    expect(earlier?.className).toContain("min-w-[4rem]");
    expect(current?.className).toContain("shrink-[0.01]");
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
    expect(more.textContent).toBe("…");
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Projects", "Board"]);
    fireEvent.click(screen.getAllByRole("menuitem")[0] as HTMLElement);
    expect(went).toEqual(["hub"]);
  });
});
