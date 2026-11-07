import { afterEach, describe, expect, test } from "bun:test";
import type { ModelOption } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { DayChart } = await import("../src/components/costs/day-chart.tsx");
const { ModelPicker } = await import("../src/components/assistant/model-picker.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

const DAYS = ["2026-11-01", "2026-11-02", "2026-11-03"];

function chart() {
  render(
    <TContext.Provider value={translator("en")}>
      <DayChart
        days={DAYS}
        byDay={[
          { day: "2026-11-01", projectKey: "web", costUsd: 1 },
          { day: "2026-11-02", projectKey: "web", costUsd: 2 },
          { day: "2026-11-02", projectKey: "api", costUsd: 0.5 },
        ]}
        projects={["web", "api"]}
        label={(key) => key.toUpperCase()}
      />
    </TContext.Provider>,
  );
}

const columns = () => screen.getAllByRole("group", { name: /^2026-11-0\d: / });

describe("sonar-a11y3: the day chart keeps its roles, names and keys", () => {
  test("each day is a named group with the total, each project's slice an image with its cost", () => {
    chart();
    expect(columns().map((c) => c.getAttribute("aria-label"))).toEqual([
      "2026-11-01: US$ 1.00",
      "2026-11-02: US$ 2.50",
      "2026-11-03: US$ 0.00",
    ]);
    expect(screen.getByRole("group", { name: "2026-11-02: US$ 2.50" }).tabIndex).toBe(-1);
    expect(screen.getAllByRole("img").map((slice) => slice.getAttribute("aria-label"))).toEqual([
      "2026-11-01 · WEB: US$ 1.00",
      "2026-11-02 · WEB: US$ 2.00",
      "2026-11-02 · API: US$ 0.50",
    ]);
    expect(
      within(screen.getByRole("group", { name: "2026-11-02: US$ 2.50" })).getAllByRole("img"),
    ).toHaveLength(2);
  });

  test("one tab stop: the arrows, Home and End walk the days, and focusing a day makes it the stop", async () => {
    chart();
    expect(columns().map((c) => c.tabIndex)).toEqual([0, -1, -1]);
    columns()[0]?.focus();
    await act(async () => {
      fireEvent.keyDown(columns()[0] as HTMLElement, { key: "ArrowRight" });
    });
    expect(document.activeElement === columns()[1]).toBe(true);
    await act(async () => {
      fireEvent.keyDown(columns()[1] as HTMLElement, { key: "End" });
    });
    expect(document.activeElement === columns()[2]).toBe(true);
    await act(async () => {
      fireEvent.keyDown(columns()[2] as HTMLElement, { key: "ArrowLeft" });
    });
    expect(document.activeElement === columns()[1]).toBe(true);
    await act(async () => {
      fireEvent.keyDown(columns()[1] as HTMLElement, { key: "Home" });
    });
    expect(document.activeElement === columns()[0]).toBe(true);
    await act(async () => {
      fireEvent.focus(columns()[2] as HTMLElement);
    });
    expect(columns().map((c) => c.tabIndex)).toEqual([-1, -1, 0]);
  });
});

const OPTIONS: ModelOption[] = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", group: "Haiku" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", group: "Sonnet" },
];

function picker(options: ModelOption[] | null) {
  render(
    <ModelPicker
      t={translator("en")}
      label="Quick model"
      defaultLabel="Provider default"
      options={options}
      value={null}
      onChange={() => {}}
    />,
  );
}

describe("sonar-a11y3: the model picker keeps its roles and names", () => {
  test("loading is a status", () => {
    picker(null);
    expect(screen.getByRole("status").textContent).toBe("Loading models…");
  });

  test("a combobox drives a named listbox of options, grouped by name", () => {
    picker(OPTIONS);
    const box = screen.getByRole("combobox", { name: "Quick model" });
    const list = screen.getByRole("listbox", { name: "Quick model" });
    expect(box.getAttribute("aria-controls")).toBe(list.id);
    expect(within(list).getAllByRole("option")).toHaveLength(3);
    const haiku = screen.getByRole("group", { name: "Haiku" });
    expect(
      within(haiku)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Haiku 5.5"]);
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Haiku",
      "Sonnet",
    ]);
  });
});
