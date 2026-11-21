import { afterEach, describe, expect, test } from "bun:test";
import type { QuotaHistory, QuotaState } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { settleMaybe, waiter } from "../wait.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { QuotaPanel } = await import("../../src/features/quota/quota-panel.tsx");
const { QuotaCharts } = await import("../../src/features/costs/QuotaCharts.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);
const settle = waiter(2000);

type Lang = "en" | "pt-BR";

const history = (window: string, projection: QuotaHistory["projection"]): QuotaHistory => ({
  window,
  hours: 5,
  samples: [],
  projection,
  consumers: [],
});

/** One online host with a reading in both windows and the costs feature, so the card asks for the projections. */
function panelStore(lang: Lang) {
  const reading = (window: string) => ({
    window,
    utilization: 0.4,
    resetsAt: null,
    status: "allowed",
  });
  const quota: Record<string, QuotaState> = {
    a: {
      windows: [reading("five_hour"), reading("seven_day")],
      pauseAt: 0.9,
      readAt: new Date().toISOString(),
    } as never,
  };
  const state = {
    hosts: [
      {
        id: "a",
        name: "a",
        status: "online",
        hostInfo: { features: ["quota", "costs"] },
      },
    ],
    quota,
    account: {},
  };
  return {
    i18n: { t: translator(lang) },
    now: () => Date.now(),
    formatTime: () => "16:00",
    subscribe: () => () => undefined,
    getState: () => state,
    hostCommand: async (_host: string, _command: string, args: { window: string }) =>
      args.window === "five_hour"
        ? history("five_hour", {
            exhaustsAt: "2026-11-21T16:00:00.000Z",
            resetsAt: null,
            samples: 3,
          })
        : history("seven_day", null),
    account: { watch: () => () => undefined },
    router: { push: () => undefined },
    quota: { setPause: async () => undefined },
  } as never;
}

describe.each(["en", "pt-BR"] as const)("the quota screens, states (%s)", (lang) => {
  const t = translator(lang);

  test("the projection is text inside its window's block, not a tooltip", async () => {
    render(
      <TContext.Provider value={t}>
        <QuotaPanel store={panelStore(lang)} />
      </TContext.Provider>,
    );
    const block = (window: string) =>
      screen.queryByRole("region")?.querySelector(`[data-window="${window}"]`) ?? null;
    const exhausts = t("quota.projection.exhausts", {
      window: t("quota.shortWindows.five_hour"),
      time: "16:00",
    });
    await settleMaybe(() => block("five_hour")?.textContent?.includes(exhausts) === true, 600);
    expect(block("five_hour")?.textContent?.includes(exhausts)).toBe(true);
    expect(block("seven_day")?.textContent?.includes(t("quota.projection.few"))).toBe(true);
    expect([
      block("five_hour")?.hasAttribute("title"),
      block("seven_day")?.hasAttribute("title"),
    ]).toEqual([false, false]);
  });

  test("the Costs charts say they are loading, then that there is nothing to show", async () => {
    const answers: Array<(value: null) => void> = [];
    const store = {
      i18n: { t },
      formatTime: () => "16:00",
      hostCommand: () => new Promise<null>((resolve) => answers.push(resolve)),
    } as never;
    render(
      <TContext.Provider value={t}>
        <QuotaCharts store={store} hostId="a" />
      </TContext.Provider>,
    );
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") }) !== null).toBe(true);
    for (const answer of answers) answer(null);
    await settle(() => screen.queryByText(t("quotaCharts.empty")) !== null);
    expect(screen.queryByText(t("quotaCharts.empty")) !== null).toBe(true);
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") }) === null).toBe(true);
  });
});
