/** The browser fixtures of the BDD steps: the demo's address and ids, and the language of the project. */
import { test as base, createBdd } from "playwright-bdd";
import { type Lang, translator } from "../../../apps/desktop/src/i18n/index.ts";
import type { Context } from "../journeys.ts";

export const test = base.extend<{ c: Context }>({
  c: async ({ page, locale }, use) => {
    const { E2E_DEMO_URL: url, E2E_DEMO_IDS: ids } = process.env;
    if (!url || !ids) throw new Error("o demo não foi iniciado (global setup)");
    const lang = locale as Lang;
    await use({ page, url, lang, ids: JSON.parse(ids), t: translator(lang) });
  },
});

export const { Given, When, Then } = createBdd(test);
