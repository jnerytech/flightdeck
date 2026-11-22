import { afterEach, describe, expect, test } from "bun:test";
import type { QuotaState } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { QuotaPanel } = await import("../../src/features/quota/quota-panel.tsx");
const { quotaBars } = await import("../../src/features/quota/domain/quota.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

const window = (name: string, utilization: number | null, status = "allowed") => ({
  window: name,
  utilization,
  resetsAt: null,
  status,
  readAt: "2026-11-22T10:00:00.000Z",
});

const state = (five: ReturnType<typeof window>, pauseAt: number | null): QuotaState =>
  ({
    windows: [five, window("seven_day", 0.2)],
    pauseAt,
    readAt: "2026-11-22T10:00:00.000Z",
  }) as never;

function store(lang: Lang, quota: QuotaState) {
  const view = {
    hosts: [
      { id: "a", name: "a", status: "online", hostInfo: { features: ["quota", "quotaPause"] } },
    ],
    quota: { a: quota },
    account: {},
  };
  return {
    i18n: { t: translator(lang) },
    now: () => Date.parse("2026-11-22T10:05:00.000Z"),
    formatTime: () => "16:00",
    subscribe: () => () => undefined,
    getState: () => view,
    hostCommand: async () => null,
    account: { watch: () => () => undefined },
    router: { push: () => undefined },
    quota: { setPause: async () => true },
  } as never;
}

const bars = (quota: QuotaState) =>
  quotaBars(quota, Date.parse("2026-11-22T10:05:00.000Z"), () => "16:00", translator("en"));
const five = (quota: QuotaState) => bars(quota)[0] as ReturnType<typeof bars>[number];

// #4304: a window the plan rejected, or at 100%, says so whatever the guard; "hot" keeps its meaning.
describe("a window that is out, whatever the guard (#4304)", () => {
  test("at 100% or rejected is out with the guard off, and hot stays for new cards waiting", () => {
    expect(five(state(window("five_hour", 1), null))).toMatchObject({ out: "full", hot: false });
    expect(five(state(window("five_hour", 0.4, "rejected"), null))).toMatchObject({
      out: "rejected",
      hot: false,
    });
    expect(five(state(window("five_hour", 0.97), null))).toMatchObject({ out: null });
    expect(five(state(window("five_hour", 0.5), null))).toMatchObject({ out: null, hot: false });
    expect(five(state(window("five_hour", 1), 0.8))).toMatchObject({ out: "full", hot: true });
  });

  test("a rejected window with no utilization has no percent to show", () => {
    expect(five(state(window("five_hour", null, "rejected"), null)).percentKnown).toBe(false);
    expect(five(state(window("five_hour", null, "rejected"), 0.8)).percentKnown).toBe(false);
    expect(five(state(window("five_hour", 0.3), null)).percentKnown).toBe(true);
  });
});

describe.each(["en", "pt-BR"] as const)("the card of a window that is out (%s)", (lang: Lang) => {
  const t = translator(lang);
  const view = (quota: QuotaState) =>
    render(
      <TContext.Provider value={t}>
        <QuotaPanel store={store(lang, quota)} />
      </TContext.Provider>,
    );
  const card = () => screen.getByRole("region").textContent ?? "";
  const row = () => document.querySelector('[data-window="five_hour"]') as HTMLElement;
  const label = t("quota.windows.five_hour");

  test("at 100% with the guard off, the bar is marked and a text says the window is out, with no claim that cards wait", () => {
    view(state(window("five_hour", 1), null));
    expect(row().getAttribute("data-out")).toBe("full");
    expect(card().includes(t("quota.out.full", { window: label }))).toBe(true);
    expect(card().includes(t("quota.hotNotice", { host: "a", pct: 0 }).slice(0, 12))).toBe(false);
  });

  test("a rejected window with no utilization shows no 0% and says the plan refused it", () => {
    view(state(window("five_hour", null, "rejected"), null));
    expect(row().textContent?.includes("0%")).toBe(false);
    expect(card().includes(t("quota.out.rejected", { window: label }))).toBe(true);
  });

  test("a window under 100% with the guard off changes nothing", () => {
    view(state(window("five_hour", 0.5), null));
    expect(row().getAttribute("data-out")).toBeNull();
    expect(card().includes(t("quota.out.full", { window: label }))).toBe(false);
  });
});
