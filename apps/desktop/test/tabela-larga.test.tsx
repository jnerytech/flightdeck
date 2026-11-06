import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RoiPeriod, RoiSummaryResult } from "@flightdeck/protocol";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { EMPTY_PERIOD } from "../src/lib/roi.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
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

// Issue #641, narrow-window guard: the return-on-cost table has nine columns that only mean
// something side by side; at 390 px it ran 781 px past its section, and the page with it. The
// spec marks it `wide`: it scrolls sideways inside its own frame, a frame the keyboard can reach
// and a screen reader names, with an edge shadow where there is more.
describe("tabela-larga: a wide table scrolls sideways inside its own frame", () => {
  test("the return-on-cost table sits in a named frame the keyboard can scroll", async () => {
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
    await settle(() => screen.queryByRole("table", { name: ptBR.roiUi.tableTitle }) !== null);
    const frame = screen.queryByRole("table", { name: ptBR.roiUi.tableTitle })?.parentElement;
    expect({
      slot: frame?.getAttribute("data-slot") ?? null,
      role: frame?.getAttribute("role") ?? null,
      name: frame?.getAttribute("aria-label") ?? null,
      focusable: frame?.getAttribute("tabindex") ?? null,
    }).toEqual({
      slot: "table-wide",
      role: "region",
      name: `${ptBR.roiUi.tableTitle}, rola para os lados`,
      focusable: "0",
    });
    store.dispose();
  });

  test("the frame scrolls sideways and shades the edge that has more", () => {
    const at = css.indexOf("@utility table-wide {");
    const block = at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
    expect({
      scrolls: block.includes("overflow-x: auto"),
      shadow: block.includes("background-attachment: local, local, scroll, scroll"),
      // In its own frame a cell never wraps: a figure stays on one line ("US$ 0.73").
      oneLine: /& :is\(th, td\) \{[^}]*white-space: nowrap/.test(block),
    }).toEqual({ scrolls: true, shadow: true, oneLine: true });
  });
});
