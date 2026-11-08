import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Budgets } from "../../daemon/src/costs/budgets.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { manualTime } from "../../daemon/test/time-helpers.ts";
import { chooseFromAccountMenu } from "./account-menu.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
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

/** Every label the budgets form and its list show, in each language (issue #1248). */
const WORDS = {
  en: {
    region: "Budgets of alfa",
    unit: "Measured in",
    usd: "US$ (dollars)",
    five: "% of the 5-hour window",
    week: "% of the weekly window",
    limit: "Limit (US$)",
    limitPct: "Limit (% of the window)",
    period: "Period",
    scope: "Scope",
    action: "When over the limit",
    create: "Create budget",
    save: "Save budget",
    edit: (label: string) => `Edit ${label}`,
    needs: "Enter a share from 0.1% to 100%.",
    estimate: "A project's share is an estimate: the plan does not say who used it.",
    host: "app budget (5-hour window)",
    row: "host budget (5-hour window) · notify · 20% of 50% of the plan (40%)",
    hostLabel: "host budget (5-hour window)",
    note: "alfa: host budget (5-hour window) at 50% of its 50% of the plan",
    dollarRow: "host budget (day) · notify · US$ 0.00 of US$ 10.00 (0%)",
  },
  "pt-BR": {
    region: "Orçamentos de alfa",
    unit: "Medido em",
    usd: "US$ (dólares)",
    five: "% da janela de 5 horas",
    week: "% da janela semanal",
    limit: "Limite (US$)",
    limitPct: "Limite (% da janela)",
    period: "Período",
    scope: "Escopo",
    action: "Ao passar do limite",
    create: "Criar orçamento",
    save: "Salvar orçamento",
    edit: (label: string) => `Editar ${label}`,
    needs: "Informe uma parte de 0,1% a 100%.",
    estimate: "A parte de um projeto é uma estimativa: o plano não diz quem usou.",
    host: "orçamento de app (janela de 5 horas)",
    row: "orçamento do host (janela de 5 horas) · notificar · 20% de 50% do plano (40%)",
    hostLabel: "orçamento do host (janela de 5 horas)",
    note: "alfa: orçamento do host (janela de 5 horas) em 50% de 50% do plano",
    dollarRow: "orçamento do host (dia) · notificar · US$ 0.00 de US$ 10.00 (0%)",
  },
} as const;

/** A host with its plan quota read (20% of the 5 hours) and budgets over it; the app online on it. */
async function online(language: keyof typeof WORDS, features?: string[]) {
  const time = manualTime(START);
  const quota = new Quota({ pauseAt: null, now: time.now, timers: time.timers });
  let budgets: Budgets | null = null;
  const d = makeDaemon(cleanups, {
    costs: true,
    quota,
    budgets: (db) => {
      budgets = new Budgets({ db, quota, now: time.now, day: () => TODAY, timers: time.timers });
      budgets.start();
      cleanups.push(() => budgets?.stop());
      return budgets;
    },
  });
  const server = features ? d.listen(0, undefined, features) : d.listen();
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const read = async (utilization: number) => {
    await act(async () => {
      quota.record([
        { window: "five_hour", utilization, status: "allowed", resetsAt: START + 2 * HOUR },
      ]);
    });
  };
  await read(0.2);
  await chooseFromAccountMenu(language === "en" ? "Settings" : "Configurações");
  const w = WORDS[language];
  await settle(() => screen.queryByRole("region", { name: w.region }) !== null);
  return { mem, read, w };
}

const rows = (region: string) =>
  [
    ...(screen.queryByRole("region", { name: region })?.querySelectorAll("li [data-row-title]") ??
      []),
  ].map((title) => title.textContent);

const field = (label: string) => {
  const found = screen.queryByLabelText(label) as HTMLInputElement | HTMLSelectElement | null;
  expect(found).not.toBeNull();
  return found as HTMLInputElement | HTMLSelectElement;
};
const choose = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(field(label), { target: { value } });
  });
};
const click = async (name: string) => {
  const button = screen.queryByRole("button", { name }) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const optionTexts = (label: string) =>
  [...((field(label) as HTMLSelectElement).options ?? [])].map((o) => o.text);

for (const language of ["en", "pt-BR"] as const) {
  describe(`orcamentos-quota-ui (${language}): a budget as a share of the plan window (#1248)`, () => {
    test("the unit offers dollars and both windows; a window drops the period and asks for a share", async () => {
      const { w } = await online(language);
      expect(optionTexts(w.unit)).toEqual([w.usd, w.five, w.week]);
      expect(screen.queryByLabelText(w.period)).not.toBeNull();
      await choose(w.unit, "five_hour");
      expect(screen.queryByLabelText(w.period)).toBeNull();
      expect(screen.queryByLabelText(w.limit)).toBeNull();
      expect(screen.queryByLabelText(w.limitPct)).not.toBeNull();
    });

    test("create, read as a share of the plan, edit, and change back to dollars", async () => {
      const { w } = await online(language);
      await choose(w.unit, "five_hour");
      await choose(w.limitPct, "50");
      await click(w.create);
      await settle(() => rows(w.region).length === 1);
      expect(rows(w.region)).toEqual([w.row]);
      await click(w.edit(w.hostLabel));
      expect((field(w.unit) as HTMLSelectElement).value).toBe("five_hour");
      expect((field(w.limitPct) as HTMLInputElement).value).toBe("50");
      await choose(w.unit, "usd");
      await choose(w.limit, "10");
      await click(w.save);
      await settle(() => rows(w.region)[0]?.includes("US$") === true);
      expect(rows(w.region)).toEqual([w.dollarRow]);
    });

    test("a share outside 0.1% to 100% cannot be saved, and says why", async () => {
      const { w } = await online(language);
      await choose(w.unit, "seven_day");
      for (const value of ["", "0", "150", "0.05"]) {
        await choose(w.limitPct, value);
        expect(
          (screen.queryByRole("button", { name: w.create }) as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(
          within(screen.getByRole("region", { name: w.region })).queryByText(w.needs),
        ).not.toBeNull();
      }
      await choose(w.limitPct, "0.1");
      expect((screen.queryByRole("button", { name: w.create }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    test("a project's share of a window says it is an estimate", async () => {
      const { w } = await online(language);
      await choose(w.unit, "five_hour");
      expect(screen.queryByText(w.estimate)).toBeNull();
      await choose(w.scope, "project");
      expect(screen.queryByText(w.estimate)).not.toBeNull();
    });

    test("crossing a threshold of a window budget notifies in shares of the plan", async () => {
      const { mem, read, w } = await online(language);
      await choose(w.unit, "five_hour");
      await choose(w.limitPct, "50");
      await click(w.create);
      await settle(() => rows(w.region).length === 1);
      await read(0.25);
      await settle(() => mem.notifications.length > 0);
      expect(mem.notifications.map((n) => n.body)).toEqual([w.note]);
    });
  });
}

describe("orcamentos-quota-ui: a host without quotaBudgets keeps the dollar form", () => {
  test("no unit field and the limit stays in dollars", async () => {
    const { w } = await online("en", ["budgets", "costs", "quota"]);
    expect(screen.queryByLabelText(WORDS.en.unit)).toBeNull();
    expect(screen.queryByLabelText(w.limit)).not.toBeNull();
  });
});
