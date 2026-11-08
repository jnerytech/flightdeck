import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Breadcrumb } = await import("../src/components/layout/breadcrumb.tsx");

const settle = waiter(4000);

/** happy-dom evaluates media queries against its viewport and fires `change` on resize. */
async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  await settle(() => window.matchMedia("(width < 1024px)").matches === width < 1024);
  await settle(() => window.matchMedia("(width < 640px)").matches === width < 640);
  await act(async () => {});
}

afterEach(async () => {
  cleanup();
  await viewport(1280);
});

const CRUMBS = [
  { label: "Hosts", route: { name: "hub" as const } },
  { label: "alfa", route: { name: "hub" as const } },
  { label: "Board of flightdeck" },
];

function path() {
  const gone: string[] = [];
  render(
    <Breadcrumb
      crumbs={CRUMBS}
      label="You are in"
      moreLabel="More"
      onGo={(route) => gone.push(route.name)}
    />,
  );
  return gone;
}
const nav = () => screen.queryByRole("navigation", { name: "You are in" });

describe("breadcrumb-widths: the header's path by window width (issue #641)", () => {
  test("wide shows the whole path", () => {
    path();
    expect(within(nav() as HTMLElement).queryByRole("button", { name: "Hosts" })).not.toBeNull();
    expect(within(nav() as HTMLElement).queryByText("Board of flightdeck")).not.toBeNull();
  });

  test("medium shows only the last step, the whole path in its tooltip and its name", async () => {
    await viewport(800);
    path();
    const bar = nav() as HTMLElement;
    expect(bar === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(within(bar).queryAllByRole("button")).toHaveLength(0);
    const last = within(bar).queryByText("Board of flightdeck");
    expect(last === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(last?.getAttribute("aria-current")).toBe("page");
    // The steps above are still there for a screen reader, in words.
    expect(bar.textContent).toContain("Hosts");
    expect(bar.textContent).toContain("alfa");
  });

  test("compact draws no path: the page header carries the title", async () => {
    await viewport(500);
    path();
    expect(nav() === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });
});
