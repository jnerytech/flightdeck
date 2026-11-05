import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerDom } from "./dom.ts";

registerDom();
const { cleanup, render } = await import("@testing-library/react");
const { DayChart } = await import("../src/components/costs/day-chart.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

afterEach(cleanup);

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");
const PROJECTS = ["web", "api", "docs", "cli", "infra", "ops"];

function chart() {
  const byDay = PROJECTS.map((projectKey, i) => ({
    day: "2026-11-01",
    projectKey,
    costUsd: 6 - i,
  }));
  render(
    <TContext.Provider value={translator("en")}>
      <DayChart days={["2026-11-01"]} byDay={byDay} projects={PROJECTS} label={(key) => key} />
    </TContext.Provider>,
  );
}

/** The chart's named series style on an element (chart-series-N), or "" when it has none. */
const series = (el: Element | null) =>
  [...(el?.classList ?? [])].find((name) => name.startsWith("chart-series-")) ?? "";

// Issue #179: the series were three tints of one indigo, and colour was the only key.
describe("cost-chart: each project of the cost chart has its own hue and its own pattern", () => {
  test("the four biggest projects get a series style each, and the rest share a fifth, 'other'", () => {
    chart();
    const of = (key: string) => series(document.querySelector(`[data-project="${key}"]`));
    const styles = PROJECTS.slice(0, 4).map(of);
    expect(new Set(styles).size).toBe(4);
    expect(styles.every((name) => name !== "")).toBe(true);
    expect(of("infra")).toBe(of("ops"));
    expect(of("infra")).not.toBe(of("web"));
  });

  test("each legend swatch has the style of its project's bars", () => {
    chart();
    const swatches = [...document.querySelectorAll("[data-swatch]")].map(series);
    const bars = ["web", "api", "docs", "cli", "infra"].map((key) =>
      series(document.querySelector(`[data-project="${key}"]`)),
    );
    expect(swatches).toEqual(bars);
  });

  test("every series style but the first draws a pattern, so a series reads without its colour", () => {
    for (const n of [2, 3, 4, 5]) {
      const start = css.indexOf(`@utility chart-series-${n} {`);
      const body = start < 0 ? "" : css.slice(start, css.indexOf("\n}", start));
      expect([n, body.includes("background-image")]).toEqual([n, true]);
    }
  });
});
