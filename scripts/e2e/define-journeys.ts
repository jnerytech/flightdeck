/**
 * The journeys of one app language, as Playwright tests: one per journey, plus the layout check.
 * Each language has a file of its own (`journeys-<language>.e2e.ts`) that calls this: Playwright
 * keeps a file's tests together on a shard, so one file for both languages put every journey on
 * shard 1 (#292). They run in one worker: the journeys share the demo of their run, and one that
 * finds what another language left (a card made by the issue journey) copes with either order.
 * `E2E_ONLY=a,b` keeps the journeys with those names (and no layout check, which is not a journey).
 */
import { test } from "@playwright/test";
import { type Lang, translator } from "../../apps/desktop/src/i18n/index.ts";
import { JOURNEYS, VIEWPORTS } from "../lib/e2e-journeys.ts";
import { type Context, journeys, layout, layoutWindows } from "./journeys.ts";

/** The demo's address and ids, which the global setup put in the environment. */
function demo() {
  const { E2E_DEMO_URL: url, E2E_DEMO_IDS: ids } = process.env;
  if (!url || !ids) throw new Error("o demo não foi iniciado (global setup)");
  return { url, ids: JSON.parse(ids) as Context["ids"] };
}

/** Defines the journeys and the layout check of one app language. */
export function defineJourneys(lang: Lang): void {
  test.describe(lang, () => {
    test.use({ viewport: VIEWPORTS[0], locale: lang });

    // What the terminal's rows hold says whether the shell answered but nothing was drawn.
    test.afterEach(async ({ page }, info) => {
      if (info.status === info.expectedStatus) return;
      const rows = await page
        .locator(".xterm-rows")
        .first()
        .textContent({ timeout: 2000 })
        .catch(() => null);
      if (rows !== null)
        await info.attach("terminal-rows", { body: rows, contentType: "text/plain" });
    });

    for (const name of JOURNEYS) {
      test(name, async ({ page }, info) => {
        const { url, ids } = demo();
        await (journeys[name] as (c: Context) => Promise<void>)({
          page,
          url,
          lang,
          ids,
          repeat: info.repeatEachIndex,
          t: translator(lang),
        });
      });
    }

    test("layout", async ({ page }) => {
      // Under the 90 s every journey gets (#1003): the check is trimmed to fit, not given more time.
      const { url, ids } = demo();
      const problems: string[] = [];
      await layout({ page, url, lang, ids, repeat: 0, t: translator(lang) }, problems);
      if (problems.length > 0) {
        throw new Error(`e2e: ${problems.length} problemas\n${problems.join("\n")}`);
      }
    });

    // The second half of the layout check, in English only: a journey of its own, so each stays
    // well under 90 s (together they took 72 to 78 s on CI).
    if (lang === "en") {
      test("layout-janelas", async ({ page }) => {
        const { url, ids } = demo();
        const problems: string[] = [];
        await layoutWindows({ page, url, lang, ids, repeat: 0, t: translator(lang) }, problems);
        if (problems.length > 0) {
          throw new Error(`e2e: ${problems.length} problemas\n${problems.join("\n")}`);
        }
      });
    }
  });
}
