import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { act, fireEvent, runCleanups, screen, settle, setup, state } from "./page-setup.tsx";

setDefaultTimeout(30_000);
afterEach(runCleanups);

/** happy-dom has no layout: every menu measures 120 x 100, as a real one measures its items. */
function measureMenusAs(width: number, height: number) {
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.getAttribute("role") === "menu"
      ? ({ width, height, left: 0, top: 0, right: width, bottom: height } as DOMRect)
      : real.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = real;
  };
}

async function rightClickAt(clientX: number, clientY: number) {
  const area = document.querySelector("[data-terminal-area]") as HTMLElement;
  await act(async () => {
    fireEvent.contextMenu(area, { clientX, clientY });
  });
  return screen.queryByRole("menu", { name: "Terminal" }) as HTMLElement;
}

// Issue #3953: the right-click menu opens inside the window, at any click point.
describe("terminal-ui: where the right-click menu opens", () => {
  test("a click that fits opens the menu at the click point", async () => {
    const restore = measureMenusAs(120, 100);
    try {
      await setup();
      await settle(() => state("Ao vivo"));
      const menu = await rightClickAt(40, 50);
      expect([menu.style.left, menu.style.top]).toEqual(["40px", "50px"]);
    } finally {
      restore();
    }
  });

  test("a click near the bottom right corner pulls the menu back inside the window", async () => {
    const restore = measureMenusAs(120, 100);
    try {
      await setup();
      await settle(() => state("Ao vivo"));
      const menu = await rightClickAt(window.innerWidth - 10, window.innerHeight - 10);
      expect([menu.style.left, menu.style.top]).toEqual([
        `${window.innerWidth - 120}px`,
        `${window.innerHeight - 100}px`,
      ]);
    } finally {
      restore();
    }
  });
});
