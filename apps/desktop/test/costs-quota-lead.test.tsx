import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);
const HOUR = 3_600_000;
let seq = 0;

/** What the Costs screen says in each language (issue #1248). */
const WORDS = {
  en: {
    lead: "Plan quota",
    total: "Estimated cost",
    five: "5 hours of alfa",
    week: "7 days of alfa",
  },
  "pt-BR": {
    lead: "Cota do plano",
    total: "Custo estimado",
    five: "5 horas de alfa",
    week: "7 dias de alfa",
  },
} as const;

/**
 * Hosts with costs on a fixed day and the app on them; `reads` gives each host's plan quota (the
 * windows it reports, or none: a host on an API key reports no window).
 */
async function online(language: keyof typeof WORDS, reads: Array<{ name: string; five?: number }>) {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  render(<App store={store} />);
  const quotas: Quota[] = [];
  for (const { name } of reads) {
    const quota = new Quota({ pauseAt: null, now: () => START });
    quotas.push(quota);
    const d = makeDaemon(cleanups, { costs: true, quota });
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, 'kA', 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, 6)`,
      )
      .run(`q${++seq}`, `${TODAY}T12:00:00.000Z`, TODAY);
    await act(async () => {
      await store.addHost({ name, url: d.listen().url, token: TOKEN });
    });
  }
  await settle(
    () => store.getState().hosts.filter((h) => h.hostInfo != null).length === reads.length,
  );
  await act(async () => {
    reads.forEach(({ five }, i) => {
      if (five === undefined) return;
      quotas[i]?.record([
        { window: "five_hour", utilization: five, status: "allowed", resetsAt: START + 2 * HOUR },
        { window: "seven_day", utilization: 0.4, status: "allowed", resetsAt: START + 48 * HOUR },
      ]);
    });
  });
  const read = reads.filter((r) => r.five !== undefined).length;
  await settle(
    () =>
      Object.values(store.getState().quota).filter((q) => q.windows.length === 2).length === read,
  );
  await act(async () => store.router.push({ name: "costs" }));
  return { store };
}

const total = (label: string) =>
  (screen.queryByLabelText(label) as HTMLElement | null)?.textContent ?? null;
const lead = (label: string) => screen.queryByRole("region", { name: label });
const meter = (label: string) =>
  screen.queryByLabelText(label) as unknown as HTMLMeterElement | null;

for (const language of ["en", "pt-BR"] as const) {
  const w = WORDS[language];
  describe(`costs-quota-lead (${language}): on a subscription the Costs screen leads with the quota (#1248)`, () => {
    test("the quota bars come before the dollars, and the dollars are still there", async () => {
      await online(language, [{ name: "alfa", five: 0.2 }]);
      await settle(() => total(w.total) === "US$ 6.00");
      expect(lead(w.lead)).not.toBeNull();
      expect(meter(w.five)?.value).toBeCloseTo(0.2);
      expect(meter(w.week)?.value).toBeCloseTo(0.4);
      const bars = lead(w.lead) as HTMLElement;
      const dollars = screen.queryByLabelText(w.total) as HTMLElement;
      expect(bars.compareDocumentPosition(dollars) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test("a host with no plan window reports leads with dollars and shows no quota block", async () => {
      await online(language, [{ name: "alfa" }]);
      await settle(() => total(w.total) === "US$ 6.00");
      expect(total(w.total)).toBe("US$ 6.00");
      expect(lead(w.lead)).toBeNull();
    });
  });
}
