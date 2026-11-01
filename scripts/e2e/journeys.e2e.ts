/**
 * `bun run e2e`: one test per journey and language, plus the layout check per language. They run
 * in this order in one worker: the journeys share the seeded demo, and the second language relies
 * on the state the first one left (see the notes in the journeys). `E2E_ONLY=a,b` keeps the
 * journeys with those names (and no layout check, which is not a journey).
 */
import { test } from "@playwright/test";
import { type Lang, translator } from "../../apps/desktop/src/i18n/index.ts";
import { JOURNEYS, LANGUAGES, VIEWPORTS } from "../lib/e2e-journeys.ts";
import { type Context, journeys, layout } from "./journeys.ts";

/** The demo's address and ids, which the global setup put in the environment. */
function demo() {
  const { E2E_DEMO_URL: url, E2E_DEMO_IDS: ids } = process.env;
  if (!url || !ids) throw new Error("o demo não foi iniciado (global setup)");
  return { url, ids: JSON.parse(ids) as Context["ids"] };
}

for (const language of LANGUAGES) {
  const lang = language as Lang;
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
      test(name, async ({ page }) => {
        const { url, ids } = demo();
        await (journeys[name] as (c: Context) => Promise<void>)({
          page,
          url,
          lang,
          ids,
          t: translator(lang),
        });
      });
    }

    test("layout", async ({ page }) => {
      const { url, ids } = demo();
      const problems: string[] = [];
      await layout({ page, url, lang, ids, t: translator(lang) }, problems);
      if (problems.length > 0) {
        throw new Error(`e2e: ${problems.length} problemas\n${problems.join("\n")}`);
      }
    });
  });
}
