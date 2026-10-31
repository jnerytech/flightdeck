/**
 * `bun run e2e` (phase 10): six journeys in a real browser against the seeded demo, in both
 * languages, and a layout check of the main screens at 1280x800 and 800x600 (nothing sticks out
 * sideways, and the end of the long list shows after scrolling). Chrome through playwright-core,
 * like the prints.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { type Lang, translator } from "../apps/desktop/src/i18n/index.ts";
import type { Route } from "../apps/desktop/src/lib/router.ts";
import { DANGER_SESSION, type DemoIds } from "./demo-seed.ts";
import { launchFirst } from "./lib/browser.ts";
import { ACOES_ACTION, JOURNEYS, LANGUAGES, VIEWPORTS } from "./lib/e2e-journeys.ts";

/** A failed journey leaves its print here; `E2E_ONLY=a,b` runs just those journeys. */
const FAILURES_DIR = process.env.E2E_FAILURES ?? join(tmpdir(), "flightdeck-e2e");
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

  // 6. Turn a GitHub issue into a card, then see the risk seal and the hold button on a high request.
  "issue-e-risco": async (c) => {
    const title = "Corrigir o login com SSO";
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    await c.page.getByRole("button", { name: c.t("issuesUi.button"), exact: true }).click();
    // The row is found by its title alone: once its card exists the row has no Criar card button.
    // The demo is seeded once for both languages, so the second language finds the card made by
    // the first, and Criar card is only there when nobody has made it yet.
    const row = c.page.locator("li", { hasText: title });
    const create = row.getByRole("button", { name: c.t("issuesUi.createCard"), exact: true });
    await create.or(row.getByText(c.t("issuesUi.cardCreated"), { exact: true })).waitFor({
      timeout: WAIT,
    });
    if ((await create.count()) > 0) await create.click();
    await row.getByText(c.t("issuesUi.cardCreated"), { exact: true }).waitFor({ timeout: WAIT });
    // The rm -rf of the terminal session waits in the queue: a red seal, and Aprovar is a hold.
    await open(c, { name: "needs-you" });
    await c.page
      .getByRole("button", { name: new RegExp(`${DANGER_SESSION}: Bash`) })
      .click({ timeout: WAIT });
    await c.page.getByText(c.t("approval.risk.high"), { exact: true }).first().waitFor({
      timeout: WAIT,
    });
    await c.page.getByRole("button", { name: c.t("approval.hold") }).waitFor({ timeout: WAIT });
    if (
      (await c.page.getByRole("button", { name: c.t("approval.approve"), exact: true }).count()) > 0
    ) {
      throw new Error("um pedido de risco alto não pode ter o botão Aprovar simples");
    }
  },

  // 9. Two tabs (Ctrl+click) and a split by the button (Chromium keeps Ctrl+T and Ctrl+W), a
  // terminal on the host with an echo, then detach and attach again: the scrollback comes back.
  "abas-terminal": async (c) => {
    const marker = `fd-${c.lang}-${Date.now()}`;
    const rows = c.page.locator(".xterm-rows");
    const shown = async () => ((await rows.first().textContent()) ?? "").split(marker).length - 1;
    await open(c, { name: "hub" });
    // A Ctrl+click opens alfa's page in a second tab (Nova aba would open the palette over the bar).
    await c.page
      .getByRole("button", { name: c.t("sidebar.openHost", { host: "alfa" }) })
      .click({ modifiers: ["Control"] });
    await waitFor(async () => (await c.page.getByRole("tab").count()) === 2, "duas abas");
    await c.page.getByRole("button", { name: c.t("tabs.split"), exact: true }).click();
    await waitFor(async () => (await c.page.getByRole("tablist").count()) === 2, "a tela dividida");
    // The new area shows alfa's page too: its Novo terminal opens the terminal there.
    await c.page
      .getByRole("button", { name: c.t("hostTerminal.open"), exact: true })
      .last()
      .click();
    await c.page
      .getByText(c.t("terminalUi.state.live"), { exact: true })
      .waitFor({ timeout: WAIT });
    // The shell draws its prompt before it reads: type only after something is on the screen.
    await waitFor(
      async () => ((await rows.first().textContent()) ?? "").trim() !== "",
      "o prompt do shell",
    );
    await c.page.locator(".xterm").first().click();
    await c.page.keyboard.type(`echo ${marker}\n`);
    // The typed line and the echo's output (a slow runner gets twice the wait).
    await waitFor(async () => (await shown()) >= 2, "o eco do terminal", WAIT * 2);
    await c.page.getByRole("button", { name: c.t("terminalUi.close"), exact: true }).click();
    await c.page.getByRole("button", { name: c.t("terminalUi.detach"), exact: true }).click();
    const attach = c.t("hostTerminal.attach", { cwd: "" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The newest live terminal is this run's: one left by a run that failed comes first.
    await c.page
      .getByRole("button", { name: new RegExp(`^${attach}`) })
      .last()
      .click();
    await c.page
      .getByText(c.t("terminalUi.state.live"), { exact: true })
      .waitFor({ timeout: WAIT });
    await waitFor(async () => (await shown()) >= 2, "o scrollback ao anexar de novo", WAIT * 2);
    // Ends it: the demo keeps its state, and the other language's run lists only its own.
    const live = c.page.getByRole("button", { name: new RegExp(`^${attach}`) });
    const before = await live.count();
    await c.page.getByRole("button", { name: c.t("terminalUi.close"), exact: true }).click();
    await c.page.getByRole("button", { name: c.t("terminalUi.end"), exact: true }).click();
    await waitFor(async () => (await live.count()) < Math.max(before, 1), "o terminal encerrado");
  },

  // 10. The project's versioned action is not trusted; trusting it asks first and then says so.
  acoes: async (c) => {
    await open(c, {
      name: "actions",
      host: ALFA,
      projectId: c.ids.project,
      projectName: "flightdeck-web",
    });
    const name = ACOES_ACTION[c.lang] as string;
    const row = c.page.getByRole("listitem", { name: c.t("actionsUi.row", { name }) });
    await row.getByText(c.t("actionsUi.notTrusted"), { exact: true }).waitFor({ timeout: WAIT });
    await row.getByRole("button", { name: c.t("actionsUi.trust", { name }) }).click();
    await c.page
      .getByRole("alertdialog")
      .getByRole("button", { name: c.t("actionsUi.trustLabel"), exact: true })
      .click();
    await row.getByText(c.t("actionsUi.trusted"), { exact: true }).waitFor({ timeout: WAIT });
  },

  // 11. A secret of the vault gets a rule (Claude is denied), saved and there when reopened.
  regras: async (c) => {
    const name = `e2e-regras-${c.lang}`;
    await open(c, { name: "vault" });
    await c.page.getByRole("button", { name: c.t("vault.newSecret"), exact: true }).click();
    await c.page.getByLabel(c.t("vault.name"), { exact: true }).fill(name);
    await c.page.getByLabel(c.t("vault.value"), { exact: true }).fill("e2e-valor-de-teste");
    await c.page.getByRole("button", { name: c.t("vault.save"), exact: true }).click();
    const rules = c.t("vaultRulesUi.open", { name });
    await c.page.getByRole("button", { name: rules, exact: true }).click();
    const editor = c.page.getByRole("region", { name: rules });
    await editor.getByRole("button", { name: c.t("vaultRulesUi.add"), exact: true }).click();
    const field = (label: string) =>
      editor.getByLabel(c.t("vaultRulesUi.at", { label, n: 1 }), { exact: true });
    await field(c.t("vaultRulesUi.requester")).selectOption("claude");
    await field(c.t("vaultRulesUi.decisionLabel")).selectOption("deny");
    await editor.getByRole("button", { name: c.t("vaultRulesUi.save"), exact: true }).click();
    await editor.waitFor({ state: "detached", timeout: WAIT });
    await c.page.getByRole("button", { name: rules, exact: true }).click();
    await waitFor(
      async () => (await field(c.t("vaultRulesUi.requester")).inputValue()) === "claude",
      "a regra salva ao reabrir",
    );
  },

  // 12. Configurações lets two projects of alfa message each other, both ways, and lists it.
  mensagens: async (c) => {
    const source = `e2e-${c.lang}`;
    await open(c, { name: "settings" });
    const section = c.page.getByRole("region", {
      name: c.t("messagingRulesUi.title", { host: "alfa" }),
    });
    await section.waitFor({ timeout: WAIT });
    const field = (label: Parameters<Context["t"]>[0]) =>
      section.getByLabel(c.t(label), { exact: true });
    await field("messagingRulesUi.from").selectOption("project");
    await field("messagingRulesUi.fromValue").fill(source);
    await field("messagingRulesUi.to").selectOption("project");
    await field("messagingRulesUi.toValue").fill("flightdeck-web");
    await field("messagingRulesUi.both").check();
    await section.getByRole("button", { name: c.t("messagingRulesUi.add"), exact: true }).click();
    const kind = c.t("messagingRulesUi.kinds.project");
    const label = c.t("messagingRulesUi.bothWays", {
      from: `${kind} ${source}`,
      to: `${kind} flightdeck-web`,
    });
    await section.getByText(label, { exact: true }).waitFor({ timeout: WAIT });
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
  const browser = await launchFirst((attempt) =>
    chromium.launch({ ...attempt, headless: true, env }),
  );
  const problems: string[] = [];
  const only = process.env.E2E_ONLY?.split(",");
  try {
    for (const language of LANGUAGES) {
      const lang = language as Lang;
      for (const name of JOURNEYS) {
        if (only && !only.includes(name)) continue;
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
          const shot = join(FAILURES_DIR, `${lang}-${name}.png`);
          await page.screenshot({ path: shot }).catch(() => {});
          problems.push(`${lang} ${name}: ${(error as Error).message.split("\n")[0]} (${shot})`);
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
