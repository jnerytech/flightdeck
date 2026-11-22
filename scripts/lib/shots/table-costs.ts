/** Part of the print table (scripts/demo-shots.ts), in print order: the Costs and ROI states (#4194). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";
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

export function costsShots(_ids: DemoIds): Shot[] {
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
  ];
}
