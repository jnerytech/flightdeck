import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { EMPTY_PERIOD } from "../src/lib/roi.ts";
import { canScrollRight } from "../src/lib/scroll-edge.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { RoiTable } = await import("../src/components/roi/roi-table.tsx");

afterEach(cleanup);
const settle = waiter(5000);
const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

const SHOP: RoiPeriod = { ...EMPTY_PERIOD, costUsd: 12, cards: 3, prsMerged: 3, hours: 6 };
const RESULT: RoiSummaryResult = {
  from: "2026-10-01",
  to: "2026-10-14",
  previousFrom: "2026-09-17",
  previousTo: "2026-09-30",
  projects: [{ projectKey: "k-shop", name: "shop", current: SHOP, previous: EMPTY_PERIOD }],
};

async function table() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  store.roiSummaries = async () => [{ hostId: "h1", result: RESULT }];
  render(
    <RoiTable
      store={store}
      hostIds={["h1"]}
      from="2026-10-01"
      to="2026-10-14"
      selection="all"
      projectName={() => "shop"}
    />,
  );
  await settle(() => screen.queryAllByRole("columnheader").length > 0);
  const frame = document.querySelector("[data-slot=table-wide]") as HTMLElement;
  return { store, frame };
}

/** Sizes happy-dom does not compute: the frame is 560 px wide over a 957 px table. */
function size(frame: HTMLElement, sizes: { left: number; client: number; scroll: number }) {
  Object.defineProperty(frame, "clientWidth", { configurable: true, value: sizes.client });
  Object.defineProperty(frame, "scrollWidth", { configurable: true, value: sizes.scroll });
  Object.defineProperty(frame, "scrollLeft", {
    configurable: true,
    writable: true,
    value: sizes.left,
  });
}

const hasMore = (frame: HTMLElement) => frame.classList.contains("table-wide-more");

// Issue #786, Costs: the cost per delivery table. Its sort headers were 19 px tall (the target
// size is 24), and at 640 and 390 px the table scrolled sideways inside its frame with nothing
// to say there was more on the right.
describe("costs-table: the sort headers are 24 px targets and a table that scrolls shows it", () => {
  test("every sort button carries the 24 px minimum height", async () => {
    const { store } = await table();
    const buttons = Array.from(document.querySelectorAll("thead th button"));
    expect({
      count: buttons.length,
      tall: buttons.filter((b) => b.classList.contains("min-h-6")).length,
    }).toEqual({ count: 9, tall: 9 });
    store.dispose();
  });

  test("canScrollRight is true until the right edge, with a pixel of slack", () => {
    expect({
      start: canScrollRight(0, 560, 957),
      middle: canScrollRight(200, 560, 957),
      oneShort: canScrollRight(395, 560, 957),
      slack: canScrollRight(396, 560, 957),
      end: canScrollRight(397, 560, 957),
      fits: canScrollRight(0, 957, 957),
      roomy: canScrollRight(0, 1200, 957),
    }).toEqual({
      start: true,
      middle: true,
      oneShort: true,
      slack: false,
      end: false,
      fits: false,
      roomy: false,
    });
  });

  test("the frame carries the fade class while it can scroll right, and loses it at the end", async () => {
    const { store, frame } = await table();
    expect(hasMore(frame)).toBe(false);
    size(frame, { left: 0, client: 560, scroll: 957 });
    await act(async () => {
      fireEvent.scroll(frame);
    });
    expect(hasMore(frame)).toBe(true);
    frame.scrollLeft = 200;
    await act(async () => {
      fireEvent.scroll(frame);
    });
    expect(hasMore(frame)).toBe(true);
    frame.scrollLeft = 397;
    await act(async () => {
      fireEvent.scroll(frame);
    });
    expect(hasMore(frame)).toBe(false);
    store.dispose();
  });

  test("a resize measures again: a window that widens past the table drops the fade", async () => {
    const { store, frame } = await table();
    size(frame, { left: 0, client: 366, scroll: 957 });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(hasMore(frame)).toBe(true);
    size(frame, { left: 0, client: 1000, scroll: 957 });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(hasMore(frame)).toBe(false);
    store.dispose();
  });

  test("the fade is an aria-hidden overlay beside the frame", async () => {
    const { store, frame } = await table();
    const fade = frame.nextElementSibling;
    expect({
      slot: fade?.getAttribute("data-slot") ?? null,
      hidden: fade?.getAttribute("aria-hidden") ?? null,
    }).toEqual({ slot: "table-wide-fade", hidden: "true" });
    store.dispose();
  });

  test("the first column (header, rows, footer) is sticky so the project stays in view", async () => {
    const { store } = await table();
    const rows = Array.from(document.querySelectorAll("table tr"));
    const firsts = rows.map((row) => row.firstElementChild?.classList.contains("table-sticky-col"));
    const others = rows.flatMap((row) =>
      Array.from(row.children)
        .slice(1)
        .map((cell) => cell.classList.contains("table-sticky-col")),
    );
    expect({
      rows: rows.length,
      sticky: firsts.filter(Boolean).length,
      others: others.filter(Boolean).length,
    }).toEqual({ rows: 3, sticky: 3, others: 0 });
    store.dispose();
  });

  test("the styles: an opaque sticky cell, a fade from the surface token to transparent", () => {
    const at = css.indexOf("@utility table-sticky-col {");
    const sticky = at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
    const fadeAt = css.indexOf('[data-slot="table-wide-fade"] {');
    const fade = fadeAt < 0 ? "" : css.slice(fadeAt, css.indexOf("\n}", fadeAt));
    expect({
      sticks: sticky.includes("position: sticky") && sticky.includes("left: 0"),
      opaque: sticky.includes("background-color: var(--background)"),
      fades: fade.includes("linear-gradient(to left, var(--background), transparent)"),
      shownByClass: css.includes('.table-wide-more + [data-slot="table-wide-fade"]'),
    }).toEqual({ sticks: true, opaque: true, fades: true, shownByClass: true });
  });
});
