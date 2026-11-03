import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const { lazyScreen, preloadAllScreens } = await import("../src/ui/lazy-screen.ts");
const screen = liveScreen(within);

function Late() {
  return createElement("p", null, "late screen");
}

describe("lazy-screen: a preloaded screen renders at once", () => {
  test("before the preload the screen shows nothing yet", () => {
    const Screen = lazyScreen(() => Promise.resolve({ Late }), "Late");
    render(createElement(Screen));
    expect(screen.queryByText("late screen")).toBeNull();
    cleanup();
  });

  test("after preloadAllScreens a screen renders in the first pass, with no waiting", async () => {
    const Screen = lazyScreen(() => Promise.resolve({ Late }), "Late");
    await preloadAllScreens();
    await act(async () => {
      render(createElement(Screen));
    });
    cleanup();
    // The same render, now synchronous: no act, no wait.
    const Again = lazyScreen(() => Promise.resolve({ Late }), "Late");
    await preloadAllScreens();
    render(createElement(Again));
    expect(screen.queryByText("late screen")).not.toBeNull();
    cleanup();
  });
});
