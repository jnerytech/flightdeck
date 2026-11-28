import { afterEach, describe, expect, jest, test } from "bun:test";
import type { QuotaHistory, QuotaState } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { settleMaybe, waiter } from "../wait.ts";

registerDom();
const { act, cleanup, render, screen } = await import("@testing-library/react");
const { QuotaPanel } = await import("../../src/features/quota/quota-panel.tsx");
const { QuotaCharts } = await import("../../src/features/costs/QuotaCharts.tsx");
const { noPlanReason } = await import("../../src/features/quota/domain/quota.ts");
const { formatAgo } = await import("../../src/i18n/format.ts");
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

/** One online host with both plan windows read now, on an account that is `stale` or not. */
function ageStore(lang: Lang, stale: boolean) {
  const readAt = new Date(Date.now()).toISOString();
  const windows = ["five_hour", "seven_day"].map((window) => ({
    window,
    utilization: 0.4,
    resetsAt: null,
    status: "allowed",
    readAt,
  }));
  const state = {
    hosts: [{ id: "a", name: "a", status: "online", hostInfo: { features: ["quota"] } }],
    quota: { a: { windows, pauseAt: 0.9, readAt } },
    account: {
      a: {
        status: "signed_in",
        name: "ana@example.com",
        error: null,
        provider: null,
        readAt,
        stale,
      },
    },
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

  test("the reason follows the account: unread and signed in give none, a failed or unknown read says so", () => {
    const of = (status: string, over: Record<string, unknown> = {}) =>
      noPlanReason(
        undefined,
        { status, provider: null, readAt: "2026-11-22T10:00:00Z", error: null, ...over } as never,
        t,
      );
    expect(of("signed_in")).toBeNull();
    expect(of("unknown", { readAt: null })).toBeNull();
    expect(of("unknown", { error: "account_unavailable" })).toBe(t("account.unavailable"));
    expect(of("unknown")).toBe(t("account.unknownSignIn"));
    expect(noPlanReason(undefined, undefined, t)).toBeNull();
    const withWindow = { windows: [{ window: "five_hour" }] } as never;
    expect(
      noPlanReason(withWindow, { status: "api_key", provider: null, readAt: null, error: null }, t),
    ).toBeNull();
  });

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
    const answers: Array<() => void> = [];
    const store = {
      i18n: { t },
      formatTime: () => "16:00",
      // The host answered: both windows hold no reading yet (a refused read is its own state, #4430).
      hostCommand: (_host: string, _command: string, args: { window: string }) =>
        new Promise<QuotaHistory>((resolve) =>
          answers.push(() => resolve(history(args.window, null))),
        ),
    } as never;
    render(
      <TContext.Provider value={t}>
        <QuotaCharts store={store} hostId="a" />
      </TContext.Provider>,
    );
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") })).not.toBeNull();
    for (const answer of answers) answer();
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
    await settle(() => screen.queryByText(t("quotaCharts.empty")) !== null);
    rerender(view("b"));
    await settleMaybe(
      () => screen.queryByRole("status", { name: t("quotaCharts.loading") }) !== null,
      600,
    );
    expect(screen.queryByRole("status", { name: t("quotaCharts.loading") })).not.toBeNull();
  });

  // #4430: the Costs charts say which window did not load, draw only what is known, and name their values.
  describe("the Costs charts' states and plot (#4430)", () => {
    const FIVE = t("quota.windows.five_hour");
    const SEVEN = t("quota.windows.seven_day");
    const sample = (hour: number, utilization: number | null) => ({
      takenAt: `2026-11-21T${String(hour).padStart(2, "0")}:00:00.000Z`,
      utilization,
      status: "allowed",
      resetsAt: null,
    });
    const answered = (window: string, ...samples: ReturnType<typeof sample>[]): QuotaHistory => ({
      ...history(window, null),
      samples,
    });
    /** A host that answers each window from `answers` (a missing one is a refused read) and counts its reads. */
    function chartsStore(
      answers: Record<string, QuotaHistory | null>,
      when: (iso: string) => string = (iso) => iso.slice(11, 16),
    ) {
      const reads: string[] = [];
      const store = {
        i18n: { t },
        formatTime: (iso: string) => iso.slice(11, 16),
        formatWhen: when,
        hostCommand: async (_host: string, _command: string, args: { window: string }) => {
          reads.push(args.window);
          return answers[args.window] ?? null;
        },
      } as never;
      return { store, reads };
    }
    const mount = (store: never) =>
      render(
        <TContext.Provider value={t}>
          <QuotaCharts store={store} hostId="a" />
        </TContext.Provider>,
      );
    const dots = (window: string) =>
      screen
        .queryByRole("region", { name: t("quotaCharts.window", { label: window }) })
        ?.querySelectorAll("[data-sample]").length ?? -1;

    test("a refused window is named with Try again, and the other window still draws", async () => {
      const { store } = chartsStore({ five_hour: answered("five_hour", sample(10, 0.4)) });
      mount(store);
      await settle(() => screen.queryAllByRole("alert").length > 0);
      expect(screen.queryByText(t("quotaCharts.failed", { label: SEVEN }))).not.toBeNull();
      expect(screen.queryByRole("button", { name: t("quotaCharts.retry") })).not.toBeNull();
      expect(dots(FIVE)).toBe(1);
      expect(screen.queryByText(t("quotaCharts.empty"))).toBeNull();
    });

    test("both windows refused is a failed state for each, not the empty text", async () => {
      mount(chartsStore({}).store);
      await settle(() => screen.queryAllByRole("alert").length > 0);
      expect(screen.queryAllByRole("alert").length).toBe(2);
      expect(screen.queryByText(t("quotaCharts.failed", { label: FIVE }))).not.toBeNull();
      expect(screen.queryByText(t("quotaCharts.failed", { label: SEVEN }))).not.toBeNull();
      expect(screen.queryByText(t("quotaCharts.empty"))).toBeNull();
    });

    test("Try again reads the windows again and draws the one that now answers", async () => {
      const answers: Record<string, QuotaHistory | null> = {
        five_hour: answered("five_hour", sample(10, 0.4)),
      };
      const { store, reads } = chartsStore(answers);
      mount(store);
      await settle(() => screen.queryAllByRole("alert").length > 0);
      answers.seven_day = answered("seven_day", sample(10, 0.2));
      const before = reads.length;
      const retry = screen.queryByRole("button", { name: t("quotaCharts.retry") });
      expect(retry).not.toBeNull();
      await act(async () => {
        (retry as HTMLElement).click();
      });
      await settle(() => dots(SEVEN) === 1);
      expect(reads.length > before).toBe(true);
      expect(screen.queryAllByRole("alert").length).toBe(0);
    });

    test("a reading with an unknown utilization has no dot, not a dot at 0%", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0.2), sample(11, null), sample(12, 0.4)),
        seven_day: answered("seven_day"),
      });
      mount(store);
      await settle(() => dots(FIVE) >= 0);
      expect(dots(FIVE)).toBe(2);
    });

    test("one reading says so, with its time", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0.4)),
        seven_day: answered("seven_day", sample(10, 0.2)),
      });
      mount(store);
      await settle(() => screen.queryAllByText(t("quotaCharts.one", { time: "10:00" })).length > 0);
      expect(screen.queryAllByText(t("quotaCharts.one", { time: "10:00" })).length).toBe(2);
    });

    test("the plot labels its 0 and 100% marks and the times it spans", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0.2), sample(12, 0.6)),
        seven_day: answered("seven_day"),
      });
      mount(store);
      await settle(() => dots(FIVE) === 2);
      const region = screen.queryByRole("region", {
        name: t("quotaCharts.window", { label: FIVE }),
      });
      const marks = [...(region?.querySelectorAll("svg text") ?? [])].map((n) => n.textContent);
      expect(marks).toEqual(["100%", "0%"]);
      expect(
        region?.textContent?.includes(t("quotaCharts.range", { from: "10:00", to: "12:00" })),
      ).toBe(true);
    });

    test("a reading at 100% and one at 0% are drawn whole, inside the svg", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0), sample(12, 1)),
        seven_day: answered("seven_day"),
      });
      mount(store);
      await settle(() => dots(FIVE) === 2);
      const svg = screen
        .queryByRole("region", { name: t("quotaCharts.window", { label: FIVE }) })
        ?.querySelector("svg");
      const [, , width = 0, height = 0] = (svg?.getAttribute("viewBox") ?? "")
        .split(" ")
        .map(Number);
      const edges = [...(svg?.querySelectorAll("[data-sample]") ?? [])].map((c) => {
        const [x, y, r] = ["cx", "cy", "r"].map((a) => Number(c.getAttribute(a)));
        return [
          (x ?? 0) - (r ?? 0) >= 0,
          (x ?? 0) + (r ?? 0) <= width,
          (y ?? 0) - (r ?? 0) >= 0,
          (y ?? 0) + (r ?? 0) <= height,
        ];
      });
      expect(edges.length).toBe(2);
      expect(edges.flat().every(Boolean)).toBe(true);
    });

    test("the plot's accessible name carries the latest value and the range", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0.2), sample(12, 0.4)),
        seven_day: answered("seven_day", sample(10, 0.2), sample(12, null)),
      });
      mount(store);
      const name = (window: string, value: string) =>
        t("quotaCharts.utilization", { label: window, value, from: "10:00", to: "12:00" });
      await settle(() => screen.queryByRole("img", { name: name(FIVE, "40") }) !== null);
      expect(screen.queryByRole("img", { name: name(FIVE, "40") })).not.toBeNull();
      expect(
        screen.queryByRole("img", {
          name: t("quotaCharts.utilizationUnknown", { label: SEVEN, from: "10:00", to: "12:00" }),
        }),
      ).not.toBeNull();
    });

    test("a window with no readings next to one with readings says so, not a bare card", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0.4)),
        seven_day: answered("seven_day"),
      });
      mount(store);
      await settle(() => dots(FIVE) === 1);
      const card = screen.queryByRole("region", {
        name: t("quotaCharts.window", { label: SEVEN }),
      });
      expect(card?.textContent?.includes(t("quotaCharts.empty"))).toBe(true);
    });

    test("the range names the day of a reading that is not from today", async () => {
      const { store } = chartsStore(
        { seven_day: answered("seven_day", sample(10, 0.2), sample(12, 0.4)) },
        (iso) => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`,
      );
      mount(store);
      await settle(() => dots(SEVEN) === 2);
      expect(
        screen.queryByText(t("quotaCharts.range", { from: "11-21 10:00", to: "11-21 12:00" })),
      ).not.toBeNull();
    });

    test("the accessible name says 100% for a reading past 100%, as the plot draws it", async () => {
      const { store } = chartsStore({
        five_hour: answered("five_hour", sample(10, 0.2), sample(12, 1.2)),
      });
      mount(store);
      await settle(() => dots(FIVE) === 2);
      const name = t("quotaCharts.utilization", {
        label: FIVE,
        value: "100",
        from: "10:00",
        to: "12:00",
      });
      expect(screen.queryByRole("img", { name })).not.toBeNull();
    });

    test("the chart follows its card's width and a long project key wraps", async () => {
      const key = "/home/ubuntu/repos/a-very-long-project-name-that-has-no-place-to-break-anywhere";
      const { store } = chartsStore({
        five_hour: {
          ...answered("five_hour", sample(10, 0.4)),
          consumers: [{ projectKey: key, costUsd: 3, share: 1 }],
        },
        seven_day: answered("seven_day"),
      });
      mount(store);
      await settle(() => dots(FIVE) === 1);
      const region = screen.queryByRole("region", {
        name: t("quotaCharts.window", { label: FIVE }),
      });
      const svg = region?.querySelector("svg");
      expect([svg?.hasAttribute("width"), svg?.classList.contains("w-full")]).toEqual([
        false,
        true,
      ]);
      const item = [...(region?.querySelectorAll("li") ?? [])].find((li) =>
        li.textContent?.includes(key),
      );
      expect(item?.classList.contains("break-all")).toBe(true);
    });
  });

  // #4303: the age of a reading moves while the screen is open, shows in the popover, and a stale reading says so.
  describe("the age of a reading (#4303)", () => {
    const view = (node: React.ReactElement) =>
      render(<TContext.Provider value={t}>{node}</TContext.Provider>);

    test("the card's age moves with the clock, with no new reading", () => {
      jest.useFakeTimers();
      try {
        view(<QuotaPanel store={ageStore(lang, false)} />);
        const region = () => screen.queryByRole("region")?.textContent ?? "";
        expect(region().includes(t("quota.read", { ago: formatAgo(5 * 60_000, t) }))).toBe(false);
        act(() => {
          jest.advanceTimersByTime(5 * 60_000);
        });
        expect(region().includes(t("quota.read", { ago: formatAgo(5 * 60_000, t) }))).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    test("the popover shows the age of each window and moves it too", () => {
      jest.useFakeTimers();
      try {
        const { container } = view(
          <QuotaDetail store={ageStore(lang, false)} onClose={() => undefined} />,
        );
        const text = () => container.textContent ?? "";
        const aged = (ms: number) =>
          text().split(t("quota.read", { ago: formatAgo(ms, t) })).length - 1;
        expect(aged(0)).toBe(2);
        act(() => {
          jest.advanceTimersByTime(5 * 60_000);
        });
        expect(aged(5 * 60_000)).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    test.each([
      ["the card", (stale: boolean) => <QuotaPanel store={ageStore(lang, stale)} />],
      [
        "the popover",
        (stale: boolean) => <QuotaDetail store={ageStore(lang, stale)} onClose={() => undefined} />,
      ],
    ])("%s marks a stale reading in words and a fresh one not", (_name, node) => {
      const stale = view(node(true));
      const mark = t("account.stale");
      expect((stale.container.textContent ?? "").includes(mark)).toBe(true);
      stale.unmount();
      const fresh = view(node(false));
      expect((fresh.container.textContent ?? "").includes(mark)).toBe(false);
    });
  });
});
