import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Breadcrumb } = await import("../../src/features/shell/breadcrumb.tsx");

afterEach(cleanup);

/**
 * What the crumbs show and do. Their layout (the slot's width, the ellipsis, the floors of a long
 * path at the narrowest window, the tab strip starting at one x) is measured in a real browser by
 * the e2e `layout` journey (`crumbsProblem` and the tab-strip check in scripts/e2e/journeys.ts);
 * happy-dom has no layout.
 */
describe("crumb-largura: a long path is folded into a menu that goes to its steps, and a long step has no native title (issue #133)", () => {
  const crumbs = [
    { label: "wsl - Ubuntu 24.04 on a long machine name", route: { name: "hub" as const } },
    { label: "Projects", route: { name: "hub" as const } },
    { label: "Board", route: { name: "hub" as const } },
    { label: "agent-runtime-delivery-lens" },
  ];

  test("a long step has no native title: the full text is in a real tooltip (texto-cortado)", () => {
    render(
      <Breadcrumb
        crumbs={[crumbs[0] as (typeof crumbs)[0], crumbs[3] as (typeof crumbs)[0]]}
        label="Path"
        onGo={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /wsl - Ubuntu/ }).getAttribute("title")).toBeNull();
    expect(screen.getByText("agent-runtime-delivery-lens").getAttribute("title")).toBeNull();
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
