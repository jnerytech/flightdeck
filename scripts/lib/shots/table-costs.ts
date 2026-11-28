/** Part of the print table (scripts/demo-shots.ts), in print order: the Costs and ROI states (#4194). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { keepSaves } from "./save-file.ts";
import { ALFA, type Shot, showSection } from "./shot.ts";
import type { WireRule } from "./wire.ts";

const WAIT = 15_000;
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name in both languages, as a pattern that must match the whole text. */
const both = (en: string, pt: string) => new RegExp(`^(${literal(en)}|${literal(pt)})$`);

/** A period in which the hosts report no cost at all: the summary every host answers. */
const NO_COST: WireRule = {
  command: "costs.summary",
  data: {
    from: "2026-11-01",
    to: "2026-11-22",
    totals: {
      costUsd: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      cacheSavingsUsd: 0,
      messages: 0,
      unpricedMessages: 0,
    },
    byDay: [],
    byProject: [],
    byModel: [],
    byOrigin: [],
    byPersona: [],
    topSessions: [],
  },
};

/** Every project away from the ROI tables: the hosts answer, and none has a cost or a delivery. */
const NO_ROI: WireRule = {
  command: "roi.summary",
  data: {
    from: "2026-11-01",
    to: "2026-11-22",
    previousFrom: "2026-10-10",
    previousTo: "2026-10-31",
    projects: [],
  },
};

const HOUR_MS = 3_600_000;
/** `count` readings of a quota window, an hour apart, ending now, the use rising by `step` each. */
const samples = (count: number, step: number) =>
  Array.from({ length: count }, (_, i) => ({
    utilization: Math.round((0.1 + i * step) * 100) / 100,
    status: "allowed",
    resetsAt: new Date(Date.now() + (count - i) * HOUR_MS).toISOString(),
    takenAt: new Date(Date.now() - (count - i) * HOUR_MS).toISOString(),
  }));

/**
 * The host's history of the 5-hour window and, in the answer after it, of the weekly one: the
 * charts ask in that order on a socket, so each draws its own window.
 */
const HISTORY: WireRule = {
  command: "quota.history",
  data: {
    window: "five_hour",
    hours: 5,
    samples: samples(6, 0.07),
    projection: null,
    consumers: [],
  },
  after: {
    window: "seven_day",
    hours: 168,
    samples: samples(10, 0.04),
    projection: null,
    consumers: [],
  },
};

/** A host budget past its limit: spent 27.40 of 20.00, the three notices crossed, new cards held. */
const OVER_LIMIT: WireRule = {
  command: "budget.list",
  data: {
    budgets: [
      {
        id: "print-over-limit",
        scope: "host",
        projectKey: null,
        period: "day",
        limitUsd: 20,
        limitPct: null,
        action: "queue",
        createdAt: "2026-11-20T08:00:00.000Z",
        periodKey: "2026-11-22",
        spentUsd: 27.4,
        spentPct: null,
        estimated: false,
        fraction: 1.37,
        crossed: [0.5, 0.8, 1],
      },
    ],
  },
};

/** The settings panel of Return on cost, scrolled into view, and the field named `label` in it. */
async function settings(page: Page) {
  const panel = page.getByRole("region", {
    name: both("Return on cost settings", "Configurações do retorno sobre o custo"),
  });
  await panel.waitFor({ timeout: WAIT });
  await panel.scrollIntoViewIfNeeded();
  return panel;
}

/** Types `text` in the rate field and presses Enter: the form saves it, or says why not. */
async function sendRate(page: Page, text: string): Promise<void> {
  const panel = await settings(page);
  const field = panel.getByRole("textbox", {
    name: both("Default hourly rate (US$)", "Valor da hora padrão (US$)"),
  });
  await field.fill(text);
  await field.press("Enter");
}

/** Types a name in the add-person form and sends it. */
async function addPerson(page: Page, name: string): Promise<void> {
  const panel = await settings(page);
  await panel.getByRole("textbox", { name: both("Person's name", "Nome da pessoa") }).fill(name);
  await panel
    .getByRole("button", { name: both("Add person", "Adicionar pessoa") })
    .click({ timeout: WAIT });
}

/** Clicks Export CSV: the toolbar's button, named in both languages. */
async function exportCsv(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: both("Export CSV", "Exportar CSV") })
    .click({ timeout: WAIT });
}

export function costsShots(ids: DemoIds): Shot[] {
  return [
    {
      // A period with no cost: the empty text and the way out to a longer period.
      name: "custos-vazio",
      route: { name: "costs" },
      wire: [NO_COST],
      prepare: async (page) => {
        await page
          .getByText(both("No cost in this period", "Nenhum custo neste período"))
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // A host that refuses the read: the error and Try again, not the loading state.
      name: "custos-recusado",
      route: { name: "costs" },
      wire: [{ command: "costs.summary", refuse: "The costs could not be read on this host." }],
      prepare: async (page) => {
        await page
          .getByRole("button", { name: both("Try again", "Tentar de novo") })
          .first()
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // One host refuses the read and the others answer: their costs, and a line naming the one that did not.
      name: "custos-parcial",
      route: { name: "costs" },
      wire: [
        {
          command: "costs.summary",
          refuse: "The costs could not be read on this host.",
          port: ids.alfaPairing.port,
        },
      ],
      prepare: async (page) => {
        await page
          .getByText(/^(No answer from|Sem resposta de): /)
          .first()
          .waitFor({ timeout: WAIT });
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(400);
      },
    },
    {
      // Costs of one project in a period it has no cost in: the notice and the way back to every host.
      name: "custos-projeto-vazio",
      route: { name: "costs", projectKey: `github.com/acme/${ids.projectName}` },
      wire: [NO_COST],
      prepare: async (page) => {
        await page
          .getByText(/(has no costs in this period|não tem custos neste período)\.\s*$/)
          .first()
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // The ROI tables when the hosts refuse the read: the error and Try again.
      name: "roi-custos-recusado",
      roi: true,
      route: { name: "costs" },
      wire: [{ command: "roi.summary", refuse: "The return could not be read on this host." }],
      prepare: async (page) => {
        await page
          .getByRole("button", { name: both("Try again", "Tentar de novo") })
          .last()
          .waitFor({ timeout: WAIT });
        await page
          .getByRole("button", { name: both("Try again", "Tentar de novo") })
          .last()
          .scrollIntoViewIfNeeded();
      },
    },
    {
      name: "roi-ajustes",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        await settings(page);
      },
    },
    {
      // A good rate saved with Enter: the status line says so.
      name: "roi-ajustes-salvo",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        await sendRate(page, "42");
        await page.getByText(both("Saved.", "Salvo.")).waitFor({ timeout: WAIT });
      },
    },
    {
      // A text that is not a number: the error under its field, with focus there.
      name: "roi-ajustes-numero-ruim",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        await sendRate(page, "abc");
        await page
          .getByText(both("Type a number.", "Digite um número."))
          .waitFor({ timeout: WAIT });
      },
    },
    {
      name: "roi-ajustes-pessoa",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        await addPerson(page, "Bia");
        await page
          .getByText(both("Person added.", "Pessoa adicionada."))
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // Removing Ana (the demo's person) asks first: their grouping and limits are lost.
      name: "roi-ajustes-remover",
      roi: true,
      route: { name: "costs" },
      prepare: async (page) => {
        const panel = await settings(page);
        await panel
          .getByRole("button", { name: both("Remove Ana", "Remover Ana") })
          .click({ timeout: WAIT });
        await page.getByRole("alertdialog").waitFor({ timeout: WAIT });
      },
    },
    {
      // The model and the origin filters in use: each select on its second option.
      name: "custos-filtros",
      route: { name: "costs" },
      prepare: async (page) => {
        for (const name of [both("Model", "Modelo"), both("Origin", "Origem")]) {
          const select = page.getByRole("combobox", { name });
          await select.waitFor({ timeout: WAIT });
          await select.selectOption({ index: 1 });
        }
        await page.mouse.move(1000, 700);
        await page.waitForTimeout(600);
      },
    },
    {
      // The export of every host saved: the dialog is answered in the page, and the line names the file.
      name: "custos-exportado",
      route: { name: "costs" },
      prepare: async (page) => {
        await page.evaluate(`(${keepSaves.toString()})(window)`);
        await exportCsv(page);
        await page.getByText(/^(Saved|Salvo) /).waitFor({ timeout: WAIT });
      },
    },
    {
      // No host gave a file: the line says nothing was saved and from whom.
      name: "custos-exportar-falhou",
      route: { name: "costs" },
      wire: [{ command: "costs.export", refuse: "The costs could not be exported on this host." }],
      prepare: async (page) => {
        await exportCsv(page);
        await page.getByText(/^(Nothing was saved|Nada foi salvo)/).waitFor({ timeout: WAIT });
      },
    },
    {
      // Every host answers and none has a cost or a delivery: the tables say so, not Try again.
      name: "roi-custos-vazio",
      roi: true,
      route: { name: "costs" },
      wire: [NO_ROI],
      prepare: async (page) => {
        const empty = page
          .getByText(
            both(
              "No project in this scope reports a cost or a delivery for this period.",
              "Nenhum projeto deste escopo tem custo ou entrega neste período.",
            ),
          )
          .first();
        await empty.waitFor({ timeout: WAIT });
        await empty.scrollIntoViewIfNeeded();
      },
    },
    {
      // One host's page: the 5-hour and weekly windows drawn over time.
      name: "custos-cota",
      route: { name: "costs", host: ALFA },
      wire: [HISTORY],
      prepare: async (page) => {
        const charts = page.getByRole("region", { name: both("Quota", "Cota") });
        await charts.getByRole("img").first().waitFor({ timeout: WAIT });
        await charts.scrollIntoViewIfNeeded();
      },
    },
    {
      // The host refuses the readings: each window says it did not load and offers Try again, not
      // that it has no readings (#4430).
      name: "custos-cota-recusada",
      route: { name: "costs", host: ALFA },
      wire: [{ command: "quota.history", refuse: "The quota could not be read on this host." }],
      prepare: async (page) => {
        const retry = page
          .getByRole("region", { name: both("Quota", "Cota") })
          .getByRole("button", { name: both("Try again", "Tentar de novo") })
          .first();
        await retry.waitFor({ timeout: WAIT });
        await retry.scrollIntoViewIfNeeded();
      },
    },
    {
      // Edit on a budget row opens the form on it, titled with the budget; nothing is saved.
      name: "configuracoes-orcamentos-editar",
      route: { name: "settings" },
      prepare: async (page) => {
        await showSection(/^(Budgets of|Orçamentos de) /)(page);
        await page.locator('[data-action="edit"]').first().click({ timeout: WAIT });
        await page
          .getByText(/^(Edit|Editar) .+ (on|em) \S+$/)
          .first()
          .waitFor({ timeout: WAIT });
      },
    },
    {
      // A budget past its limit: the meter over 100% and the action that holds new cards.
      name: "configuracoes-orcamentos-limite",
      route: { name: "settings" },
      wire: [OVER_LIMIT],
      prepare: async (page) => {
        await showSection(/^(Budgets of|Orçamentos de) /)(page);
        await page
          .getByRole("meter", { name: /(of the limit|do limite)$/ })
          .first()
          .waitFor({ timeout: WAIT });
      },
    },
  ];
}
