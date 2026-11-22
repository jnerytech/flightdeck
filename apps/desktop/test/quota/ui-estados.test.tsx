import { afterEach, describe, expect, test } from "bun:test";
import type { QuotaHistory, QuotaState } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { settleMaybe, waiter } from "../wait.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { QuotaPanel } = await import("../../src/features/quota/quota-panel.tsx");
const { QuotaCharts } = await import("../../src/features/costs/QuotaCharts.tsx");
const { QuotaDetail } = await import("../../src/features/shell/quota-detail.tsx");
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

/** One online host with the quota feature and no window yet, on the account the test gives (or none read yet). */
function planlessStore(lang: Lang, account: Record<string, unknown>) {
  const state = {
    hosts: [{ id: "a", name: "a", status: "online", hostInfo: { features: ["quota"] } }],
    quota: {},
    account,
  };
  return {
    i18n: { t: translator(lang) },
    now: () => Date.now(),
    formatTime: () => "16:00",
    subscribe: () => () => undefined,
    getState: () => state,
    hostCommand: async () => null,
    account: { watch: () => () => undefined },
    router: { push: () => undefined },
    quota: { setPause: async () => undefined },
  } as never;
}

const signedIn = { status: "signed_in", name: "ana@example.com", error: null, provider: null };

describe.each(["en", "pt-BR"] as const)("the quota screens, states (%s)", (lang) => {
  const t = translator(lang);

  // #4302: a host with no plan window and a known account says why, not "no reading yet".
  const planless: Array<[string, Record<string, unknown>, string]> = [
    [
      "an API key",
      { status: "api_key", name: null, error: null, provider: null },
      t("account.apiKey"),
    ],
    [
      "a third-party provider",
      { status: "third_party", name: null, error: null, provider: "Bedrock" },
      t("account.provider", { provider: "Bedrock" }),
    ],
    [
      "no sign-in",
      { status: "signed_out", name: null, error: null, provider: null },
      t("account.signedOut.title"),
    ],
  ];

  test.each(planless)(
    "the card of a host on %s says why there is no plan quota",
    async (_name, account, reason) => {
      render(
        <TContext.Provider value={t}>
          <QuotaPanel store={planlessStore(lang, { a: account })} />
        </TContext.Provider>,
      );
      const region = screen.queryByRole("region");
      expect(region?.textContent?.includes(reason)).toBe(true);
      expect(region?.textContent?.includes(t("quota.noReading"))).toBe(false);
    },
  );

  test.each(planless)(
    "the popover says it once for a host on %s, not once per window",
    async (_name, account, reason) => {
      const { container } = render(
        <TContext.Provider value={t}>
          <QuotaDetail store={planlessStore(lang, { a: account })} onClose={() => undefined} />
        </TContext.Provider>,
      );
      const text = container.textContent ?? "";
      expect(text.split(reason).length - 1).toBe(1);
      expect(text.includes(t("quota.noReading"))).toBe(false);
    },
  );

  test.each([
    ["signed in", { a: signedIn }],
    ["not read yet", {}],
  ])(
    "a host %s with no window yet still reads no reading yet, in the card and the popover",
    async (_name, account) => {
      const store = planlessStore(lang, account);
      const card = render(
        <TContext.Provider value={t}>
          <QuotaPanel store={store} />
        </TContext.Provider>,
      );
      expect(screen.queryByRole("region")?.textContent?.includes(t("quota.noReading"))).toBe(true);
      card.unmount();
      const popover = render(
        <TContext.Provider value={t}>
          <QuotaDetail store={store} onClose={() => undefined} />
        </TContext.Provider>,
      );
      expect(popover.container.textContent?.includes(t("quota.noReading"))).toBe(true);
    },
  );

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
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") })).not.toBeNull();
    for (const answer of answers) answer(null);
    await settle(() => screen.queryByText(t("quotaCharts.empty")) !== null);
    expect(screen.queryByText(t("quotaCharts.empty"))).not.toBeNull();
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") })).toBeNull();
  });

  test("another host's charts start from loading, not from the previous host's charts", async () => {
    const pending: Array<(value: QuotaHistory | null) => void> = [];
    const store = {
      i18n: { t },
      formatTime: () => "16:00",
      hostCommand: (host: string, _command: string, args: { window: string }) =>
        host === "a"
          ? Promise.resolve(history(args.window, null))
          : new Promise<QuotaHistory | null>((resolve) => pending.push(resolve)),
    } as never;
    const view = (hostId: string) => (
      <TContext.Provider value={t}>
        <QuotaCharts store={store} hostId={hostId} />
      </TContext.Provider>
    );
    const { rerender } = render(view("a"));
    await settle(() => screen.queryAllByRole("region", { name: /./ }).length > 1);
    rerender(view("b"));
    await settleMaybe(
      () => screen.queryByRole("status", { name: t("quotaCharts.loading") }) !== null,
      600,
    );
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") })).not.toBeNull();
  });
});
