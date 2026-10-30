/**
 * `bun run e2e` (phase 10): six journeys in a real browser against the seeded demo, in both
 * languages, and a layout check of the main screens at 1280x800 and 800x600 (nothing sticks out
 * sideways, and the end of the long list shows after scrolling). Chrome through playwright-core,
 * like the prints.
 */
import { chromium, type Page } from "playwright-core";
import { type Lang, translator } from "../apps/desktop/src/i18n/index.ts";
import type { Route } from "../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "./demo-seed.ts";
import { JOURNEYS, LANGUAGES, VIEWPORTS } from "./lib/e2e-journeys.ts";

const ALFA = "demo-alfa";
const WAIT = 15_000;

type Context = {
  page: Page;
  url: string;
  lang: Lang;
  ids: DemoIds;
  t: ReturnType<typeof translator>;
};

/** Opens a screen of the demo; `prefs` stores the theme and language like the prints do. */
async function open(c: Context, route: Route, prefs = true) {
  const query = new URLSearchParams({ route: JSON.stringify(route) });
  if (prefs) {
    query.set("lang", c.lang);
    query.set("theme", "light");
  }
  await c.page.goto(`${c.url}?${query}`);
  await c.page.waitForTimeout(1500);
}

async function waitFor(check: () => Promise<boolean>, what: string, timeout = WAIT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`esperava: ${what}`);
}

const journeys: Record<string, (c: Context) => Promise<void>> = {
  // 1. Approve a Bash request from the queue with the A key and see the queue shrink.
  "aprovar-bash-com-a": async (c) => {
    // Any request will do: the demo keeps its state from one journey to the next.
    const rows = c.page.locator("main ul li button");
    await open(c, { name: "needs-you" });
    await rows.first().waitFor({ timeout: WAIT });
    const before = await rows.count();
    await rows.first().click();
    const card = c.page.locator("fieldset[data-request-id]").first();
    await card.waitFor({ timeout: WAIT });
    await card.focus();
    await c.page.keyboard.press("a");
    await waitFor(async () => (await rows.count()) < before, "o pedido saiu da fila");
  },

  // 2. Open a session, send a message and read the fake runtime's answer.
  "sessao-e-mensagem": async (c) => {
    await open(c, { name: "session", host: ALFA, id: c.ids.idleSession });
    const box = c.page.getByLabel(c.t("session.message"), { exact: true });
    await box.fill("ola do e2e");
    await box.press("Control+Enter");
    await c.page.getByText("Echo: ola do e2e").first().waitFor({ timeout: WAIT });
  },

  // 3. Create a card, start it, then open a card's diff.
  "card-diff": async (c) => {
    const title = `Card e2e ${Date.now()}`;
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    // The new-card dialog: Novo card, the title, Criar card.
    await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
    await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
    await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
    const tile = c.page.locator(`li[aria-label="${c.t("kanban.card", { title })}"]`);
    await tile.waitFor({ timeout: WAIT });
    await tile.getByRole("button", { name: title, exact: true }).click();
    await c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
    await open(c, { name: "card", host: ALFA, projectId: c.ids.project, cardId: c.ids.diffCard });
    await c.page.getByRole("button", { name: c.t("cardUi.diff"), exact: true }).click();
    await c.page.getByRole("region", { name: c.t("diff.unifiedLabel") }).waitFor({ timeout: WAIT });
  },

  // 4. Comment on a line of the card's diff and send the review to the agent.
  "revisao-comentar-e-enviar": async (c) => {
    await open(c, { name: "card", host: ALFA, projectId: c.ids.project, cardId: c.ids.diffCard });
    await c.page.getByRole("button", { name: c.t("cardUi.diff"), exact: true }).click();
    const line = c.t("changes.commentLine", { line: 1, path: "fake-1.txt" });
    await c.page.getByRole("button", { name: line, exact: true }).click({ timeout: WAIT });
    await c.page
      .getByLabel(c.t("changes.commentLabel"), { exact: true })
      .fill("Explique esta linha");
    await c.page.getByRole("button", { name: c.t("changes.addComment"), exact: true }).click();
    await c.page.getByRole("button", { name: c.t("changes.send", { n: 1 }), exact: true }).click();
    // The demo keeps what the other language sent: the history may hold more than one.
    await c.page.getByText(c.t("changes.sent"), { exact: true }).first().waitFor({ timeout: WAIT });
  },

  // 5. Open the palette, search the history and open the reader.
  "paleta-e-leitor": async (c) => {
    await open(c, { name: "hub" });
    await c.page.keyboard.press("Control+K");
    const input = c.page.getByLabel(c.t("searchUi.input"), { exact: true });
    await input.fill("revisão do arquivo");
    await input.press("Enter");
    const hit = c.page
      .getByRole("list", { name: c.t("searchUi.results") })
      .getByRole("button")
      .first();
    await hit.waitFor({ timeout: WAIT });
    await hit.click();
    await c.page.getByRole("log", { name: c.t("reader.transcript") }).waitFor({ timeout: WAIT });
  },

  // 7. Rewind the files of a turn from the timeline and undo it (the demo keeps its state from
  // one language to the next, so the journey ends where it began).
  "voltar-arquivos": async (c) => {
    await open(c, { name: "session", host: ALFA, id: c.ids.rewindSession });
    await c.page.getByRole("button", { name: c.t("timeline.open"), exact: true }).click();
    await c.page
      .getByRole("button", { name: c.t("timeline.rewindTurn", { n: 2 }), exact: true })
      .click();
    const confirm = c.page.getByRole("button", {
      name: c.t("timeline.rewindConfirm"),
      exact: true,
    });
    await waitFor(() => confirm.isEnabled(), "a prévia do que volta");
    await confirm.click();
    await c.page
      .getByText(c.t("timeline.rewound", { n: 2 }), { exact: true })
      .waitFor({ timeout: WAIT });
    await c.page.getByRole("button", { name: c.t("timeline.undo"), exact: true }).click();
    await c.page.getByText(c.t("timeline.undone"), { exact: true }).waitFor({ timeout: WAIT });
  },

  // 6. Switch the theme and the language and see both kept after a reload.
  "tema-e-idioma": async (c) => {
    await open(c, { name: "settings" }, false);
    const other: Lang = c.lang === "pt-BR" ? "en" : "pt-BR";
    await c.page.getByLabel(c.t("settings.theme"), { exact: true }).selectOption("dark");
    await c.page.getByLabel(c.t("settings.language"), { exact: true }).selectOption(other);
    await c.page.reload();
    await c.page.waitForTimeout(1500);
    await waitFor(
      async () => await c.page.evaluate(() => document.documentElement.classList.contains("dark")),
      "o tema escuro voltou",
    );
    await waitFor(
      async () => (await c.page.evaluate(() => document.documentElement.lang)) === other,
      "o idioma voltou",
    );
  },
};

/** What sticks out of the window sideways, outside a box that scrolls. */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > width) found.push("a página rola para o lado");
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= width + 1) continue;
      let scrolls = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX;
        if (x === "auto" || x === "scroll" || x === "hidden" || x === "clip") scrolls = true;
      }
      const visibility = getComputedStyle(el);
      if (!scrolls && visibility.display !== "none" && visibility.visibility !== "hidden") {
        found.push(`${el.tagName.toLowerCase()} ${String(el.className).slice(0, 50)}`);
      }
      if (found.length >= 5) break;
    }
    return found;
  });
}

/** After scrolling every box to its end, the last row of the list is on screen (or why not). */
async function lastRowProblem(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Only the boxes a person can scroll.
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const overflowY = getComputedStyle(el).overflowY;
      if (
        el.scrollHeight > el.clientHeight + 4 &&
        (overflowY === "auto" || overflowY === "scroll")
      ) {
        el.scrollTop = el.scrollHeight;
      }
    }
    const rows = [...document.querySelectorAll<HTMLElement>("main li[aria-label]")];
    const last = rows.at(-1);
    if (!last) return "nenhuma linha";
    const box = last.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight + 1) return null;
    return `${last.getAttribute("aria-label")} em ${Math.round(box.top)}..${Math.round(box.bottom)} de ${window.innerHeight}`;
  });
}

async function layout(c: Context, problems: string[]) {
  const screens: Array<[string, Route]> = [
    ["hub", { name: "hub" }],
    ["precisa-de-voce", { name: "needs-you" }],
    ["sessao", { name: "session", host: ALFA, id: c.ids.idleSession }],
    ["board", { name: "board", host: ALFA, projectId: c.ids.project }],
    ["host", { name: "host", host: ALFA }],
    ["custos", { name: "costs" }],
    ["configuracoes", { name: "settings" }],
    [
      "agente",
      { name: "agent", host: ALFA, projectId: c.ids.project, projectName: c.ids.projectName },
    ],
    ["historico", { name: "history", host: ALFA }],
  ];
  for (const viewport of VIEWPORTS) {
    await c.page.setViewportSize(viewport);
    for (const [name, route] of screens) {
      await open(c, route);
      const where = `${c.lang} ${viewport.width}x${viewport.height} ${name}`;
      for (const issue of await overflow(c.page)) problems.push(`${where}: ${issue}`);
    }
    await open(c, { name: "hub" });
    const hidden = await lastRowProblem(c.page);
    if (hidden) {
      problems.push(
        `${c.lang} ${viewport.width}x${viewport.height}: o fim da lista não aparece depois de rolar (${hidden})`,
      );
    }
  }
}

export async function runE2e(
  url: string,
  ids: DemoIds,
  env: Record<string, string>,
  log: (msg: string) => void,
): Promise<void> {
  const browser = await chromium
    .launch({ channel: "chrome", headless: true, env })
    .catch(() => chromium.launch({ channel: "msedge", headless: true, env }));
  const problems: string[] = [];
  try {
    for (const language of LANGUAGES) {
      const lang = language as Lang;
      for (const name of JOURNEYS) {
        // A page of its own per journey: the app keeps its choices in the page's storage.
        const context = await browser.newContext({
          viewport: VIEWPORTS[0] ?? { width: 1280, height: 800 },
          locale: lang,
        });
        const page = await context.newPage();
        const c: Context = { page, url, lang, ids, t: translator(lang) };
        try {
          await (journeys[name] as (c: Context) => Promise<void>)(c);
          log(`${lang} ${name}: ok`);
        } catch (error) {
          problems.push(`${lang} ${name}: ${(error as Error).message.split("\n")[0]}`);
        }
        await context.close();
      }
      const context = await browser.newContext({
        viewport: VIEWPORTS[0] ?? { width: 1280, height: 800 },
        locale: lang,
      });
      const page = await context.newPage();
      await layout({ page, url, lang, ids, t: translator(lang) }, problems);
      await context.close();
      log(`${lang} layout: conferido`);
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0)
    throw new Error(`e2e: ${problems.length} problemas\n${problems.join("\n")}`);
}
