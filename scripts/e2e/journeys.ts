/**
 * The e2e journeys (phase 10): sixteen in a real browser against the seeded demo, in both
 * languages, and a layout check of the main screens at 1280x800 and 800x600 (nothing sticks out
 * sideways, and the end of the long list shows after scrolling). The runner is `@playwright/test`
 * (scripts/e2e/journeys.e2e.ts); this file holds the journeys themselves.
 */
import { expect, type Page } from "@playwright/test";
import type { Lang, translator } from "../../apps/desktop/src/i18n/index.ts";
import type { Route } from "../../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "../demo-seed.ts";
import { acoesAction, DANGER_SESSION, OVERFLOW_VIEWPORTS, VIEWPORTS } from "../lib/e2e-journeys.ts";
import { ensureOnline } from "../lib/e2e-online.ts";

const ALFA = "demo-alfa";
export const WAIT = 15_000;
/** A session needs the host to start it: on a loaded machine that takes far longer than a click. */
export const SESSION_WAIT = 60_000;

export type Context = {
  page: Page;
  url: string;
  lang: Lang;
  ids: DemoIds;
  /** Which repeat of the journey this is (`--repeat-each`), 0 for a plain run. */
  repeat: number;
  t: ReturnType<typeof translator>;
};

/** Opens a screen of the demo; `prefs` stores the theme and language like the prints do. */
export async function open(c: Context, route: Route, prefs = true) {
  const query = new URLSearchParams({ route: JSON.stringify(route) });
  if (prefs) {
    query.set("lang", c.lang);
    query.set("theme", "light");
  }
  // The prints keep the demo's long wait between attempts; a journey needs a lost first
  // connection to heal in seconds.
  query.set("reconnect", "fast");
  await c.page.goto(`${c.url}?${query}`);
  await c.page.waitForTimeout(1500);
  await ensureOnline({
    online: () => demoHostsOnline(c),
    reload: async () => void (await c.page.reload()),
    sleep: (ms) => c.page.waitForTimeout(ms),
    now: () => Date.now(),
  });
}

/** The sidebar's dots of the demo hosts a journey uses: none of them reads offline or connecting. */
async function demoHostsOnline(c: Context): Promise<boolean> {
  for (const name of ["alfa", "beta"]) {
    const dot = (state: string | RegExp) =>
      c.page.getByRole("img", { name: state, exact: typeof state === "string" });
    const online = c.t("sidebar.hostState", { host: name, state: c.t("hosts.status.online") });
    if ((await dot(online).count()) > 0) continue;
    // A dot that says anything else is a host that is not up; no dot at all is a page that cannot tell.
    if ((await dot(new RegExp(`^${name}: `)).count()) > 0) return false;
  }
  return true;
}

/** Starts a session of the fake runtime from the New session screen. */
export async function createSession(c: Context, prompt: string, name?: string) {
  await open(c, { name: "new-session", host: ALFA });
  if (name) await c.page.getByLabel(c.t("newSession.name"), { exact: false }).fill(name);
  await c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt);
  await c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click();
}

export async function waitFor(check: () => Promise<boolean>, what: string, timeout = WAIT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`esperava: ${what}`);
}

export const journeys: Record<string, (c: Context) => Promise<void>> = {
  // 1. Approve a Bash request from the queue with the A key and see the queue shrink.
  "aprovar-bash-com-a": async (c) => {
    // The demo's seeded requests run out after a few runs, so the journey asks for its own.
    const session = `Aprovar e2e ${Date.now()}`;
    await createSession(c, "[bash] ls", session);
    await open(c, { name: "needs-you" });
    const row = c.page.locator("main ul li button", { hasText: session });
    await row.first().click({ timeout: SESSION_WAIT });
    const card = c.page.locator("fieldset[data-request-id]").first();
    await card.waitFor({ timeout: WAIT });
    await card.focus();
    await c.page.keyboard.press("a");
    await waitFor(async () => (await row.count()) === 0, "o pedido saiu da fila");
  },

  // 2. Open a session, send a message and read the fake runtime's answer.
  "sessao-e-mensagem": async (c) => {
    await open(c, { name: "session", host: ALFA, id: c.ids.idleSession });
    const box = c.page.getByLabel(c.t("session.message"), { exact: true });
    await box.fill("ola do e2e");
    await box.press("Enter");
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
    // Issue #188: the creation says so, with a way to the new card.
    await c.page
      .getByText(c.t("kanban.created", { title }), { exact: true })
      .waitFor({ timeout: WAIT });
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
    // A short prompt first: the runner's is 50+ columns ("runner@host:/tmp/fd-demo-X/alfa/projects$")
    // and the area of a split window is about 60, so the typed line would scroll sideways and the
    // marker would come out cut in two.
    await c.page.keyboard.type("PS1='$ '\n");
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
    const name = acoesAction(c.lang, c.repeat);
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
    // A rule of the same pair is listed once per run, and the demo keeps them all.
    const source = `e2e-${c.lang}-${Date.now()}`;
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

  // 13. Clientes: a client with a remote rule is created, picked in the switcher, and narrows Sessões.
  clientes: async (c) => {
    const name = `e2e-${c.lang}`;
    await open(c, { name: "clients" });
    await c.page.getByLabel(c.t("clients.nameLabel"), { exact: true }).fill(name);
    await c.page.getByRole("button", { name: c.t("clients.create"), exact: true }).click();
    const row = c.page.locator("li", {
      has: c.page.locator("[data-client-name]", { hasText: name }),
    });
    await row.waitFor({ timeout: WAIT });
    await row.getByLabel(c.t("clients.valueLabel"), { exact: true }).fill("github.com/acme/*");
    await row.getByRole("button", { name: c.t("clients.addRule"), exact: true }).click();
    await row
      .getByRole("list", { name: c.t("clients.rulesOf", { name }) })
      .waitFor({ timeout: WAIT });
    // Every session of the demo, then only the client's (the demo's sessions are in other projects).
    await open(c, { name: "hub" });
    const sessions = c.page.getByRole("list").locator("li[aria-label]");
    await sessions.first().waitFor({ timeout: WAIT });
    const before = await sessions.count();
    const switcher = (current: string) =>
      c.page.getByRole("button", { name: c.t("clients.switcher", { name: current }), exact: true });
    await switcher(c.t("clients.allClients")).click();
    await c.page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
    await switcher(name).waitFor({ timeout: WAIT });
    await waitFor(async () => (await sessions.count()) < before, "só as sessões do cliente");
  },

  // 14. Dependencias: a card is blocked by another, its start is refused with the title, and the
  // blocker in Done unblocks it.
  dependencias: async (c) => {
    // The demo keeps its cards between runs and languages: titles of their own.
    const stamp = `${c.lang}-${Date.now()}`;
    const first = `Base ${stamp}`;
    const second = `Depende ${stamp}`;
    const tile = (title: string) =>
      c.page.locator(`li[aria-label="${c.t("kanban.card", { title })}"]`);
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    for (const title of [first, second]) {
      await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
      await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
      await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
      await tile(title).waitFor({ timeout: WAIT });
    }
    await tile(second).getByRole("button", { name: second, exact: true }).click();
    await c.page.getByLabel(c.t("deps.addLabel"), { exact: true }).selectOption({ label: first });
    await c.page.getByRole("button", { name: c.t("deps.add"), exact: true }).click();
    await c.page
      .getByRole("button", { name: c.t("deps.remove", { title: first }), exact: true })
      .waitFor({ timeout: WAIT });
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    await tile(second)
      .getByText(c.t("deps.blocked", { count: 1 }), { exact: true })
      .waitFor({ timeout: WAIT });
    const actions = (title: string) =>
      tile(title).getByRole("button", { name: c.t("board.cardActions", { title }), exact: true });
    await actions(second).click();
    await c.page.getByRole("menuitem", { name: c.t("board.startCard"), exact: true }).click();
    await c.page
      .getByText(c.t("daemonRefusal.card_blocked", { blockers: first }), { exact: true })
      .waitFor({ timeout: WAIT });
    await actions(first).click();
    await c.page
      .getByRole("menuitem", {
        name: c.t("board.moveTo", { column: c.t("kanban.columns.done") }),
        exact: true,
      })
      .click();
    await tile(second).getByText(c.t("deps.unblocked"), { exact: true }).waitFor({ timeout: WAIT });
  },

  // 15. A long conversation opens on its latest message, stays put when scrolled up while a message
  // arrives (the button counts it), and is where the reader left it when they come back.
  "rolagem-fim": async (c) => {
    const bottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;
    await open(c, { name: "session", host: ALFA, id: c.ids.scrollSession });
    await c.page
      .getByText("Echo: Passo 24:", { exact: false })
      .first()
      .waitFor({ timeout: SESSION_WAIT });
    const log = c.page
      .locator("[tabindex='0'].overflow-y-auto")
      .filter({ hasText: "Passo 24" })
      .first();
    // The code block and the summary are what push the layout after the first paint.
    await c.page.locator("pre").first().waitFor({ timeout: WAIT });
    await c.page
      .getByRole("region", { name: c.t("recap.region") })
      .waitFor({ timeout: SESSION_WAIT });
    await waitFor(async () => (await log.evaluate(bottom)) <= 24, "a conversa abriu no fim");
    // Scrolled up, a message that arrives leaves the view where it was and is counted.
    await log.evaluate((el) => {
      el.scrollTop = 300;
    });
    const jump = c.page.getByRole("button", { name: new RegExp(`^${c.t("session.jumpLatest")}$`) });
    await jump.waitFor({ timeout: WAIT });
    const kept = await log.evaluate((el) => el.scrollTop);
    const box = c.page.getByLabel(c.t("session.message"), { exact: true });
    await box.fill("mais uma do e2e");
    await box.press("Enter");
    await c.page
      .getByRole("button", { name: /\(\d+ (new|nova|novas)\)/ })
      .waitFor({ timeout: SESSION_WAIT });
    await c.page.waitForTimeout(500);
    expect(Math.abs((await log.evaluate((el) => el.scrollTop)) - kept)).toBeLessThanOrEqual(2);
    // Leaving the screen for another and coming back: the same place.
    await c.page.getByRole("button", { name: c.t("sidebar.projects"), exact: true }).click();
    await log.waitFor({ state: "detached", timeout: WAIT });
    await c.page
      .getByRole("tab", { name: /Conversa longa/ })
      .first()
      .click();
    const back = c.page
      .locator("[tabindex='0'].overflow-y-auto")
      .filter({ hasText: "Passo 24" })
      .first();
    await back.waitFor({ timeout: WAIT });
    await c.page.waitForTimeout(500);
    expect(Math.abs((await back.evaluate((el) => el.scrollTop)) - kept)).toBeLessThanOrEqual(2);
  },

  // 16. The first run (issue #184): a pasted link that is not a pairing link is answered in the
  // app's language, from the catalog.
  "primeira-vez": async (c) => {
    await open(c, { name: "add-host" });
    await c.page
      .getByLabel(c.t("hostForm.link"), { exact: true })
      .fill("flightdeck://pc:7420?name=x");
    await c.page.getByText(c.t("hostForm.pairToken"), { exact: true }).waitFor({ timeout: WAIT });
    await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).fill("http://pc:7420?token=t");
    await c.page.getByText(c.t("hostForm.pairScheme"), { exact: true }).waitFor({ timeout: WAIT });
  },

  // 17. A second host (issue #185): "Add a host" is a command of the palette and opens the form.
  "segundo-host": async (c) => {
    await open(c, { name: "hub" });
    await c.page.keyboard.press("Control+K");
    await c.page.getByLabel(c.t("searchUi.input"), { exact: true }).fill(c.t("palette.addHost"));
    await c.page.getByText(c.t("palette.addHost"), { exact: true }).first().click();
    await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).waitFor({ timeout: WAIT });
  },

  // 18. New session (issue #186): the Sessions list starts one, and the form lets the host be chosen.
  "nova-sessao-host": async (c) => {
    await open(c, { name: "hub" });
    await c.page
      .locator('[data-slot="page-actions"]')
      .first()
      .getByRole("button", { name: c.t("sidebar.newSession"), exact: true })
      .click();
    const host = c.page.getByLabel(c.t("newSession.host"), { exact: true });
    await host.waitFor({ timeout: WAIT });
    await host.selectOption({ label: "beta" });
    await c.page
      .getByRole("heading", { name: c.t("newSession.title", { host: "beta" }) })
      .waitFor({ timeout: WAIT });
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

/** The page never scrolls sideways: when it does, the widest element sticking out is named. */
async function pageScrollsSideways(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth && document.body.scrollWidth <= root.clientWidth) {
      return null;
    }
    let widest = { name: "?", right: 0 };
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > widest.right) {
        widest = {
          name: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`,
          right: box.right,
        };
      }
    }
    return `scrollWidth ${root.scrollWidth} > ${root.clientWidth}; widest ${widest.name} ends at ${Math.round(widest.right)}`;
  });
}

/** The crumbs end before the bell, and what does not fit is cut with an ellipsis (issue #133). */
async function crumbsProblem(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>(".header-crumbs");
    const nav = slot?.querySelector<HTMLElement>("nav");
    const bell = slot?.lastElementChild as HTMLElement | null;
    if (!slot || !nav || !bell || bell === nav) return "no breadcrumb";
    const limit = bell.getBoundingClientRect().left + 1;
    // Where the person is must stay readable: the current step never shrinks to nothing.
    const current = nav.querySelector<HTMLElement>("[aria-current='page']");
    if (current && current.getBoundingClientRect().width < 48) {
      return `the current crumb (${current.textContent}) is ${Math.round(current.getBoundingClientRect().width)}px wide`;
    }
    for (const el of nav.querySelectorAll<HTMLElement>("li > *")) {
      const box = el.getBoundingClientRect();
      if (box.right > limit)
        return `a crumb (${el.textContent}) ends at ${Math.round(box.right)}, past the bell at ${Math.round(limit)}`;
      if (el.scrollWidth > el.clientWidth + 1) {
        const style = getComputedStyle(el);
        if (style.textOverflow !== "ellipsis" || style.overflow !== "hidden") {
          return `a crumb (${el.textContent}) is cut without an ellipsis`;
        }
      }
    }
    return null;
  });
}

/** The tabs share the strip like a browser's: one width, and not under the minimum. */
async function tabWidthsProblem(page: Page, minimum: number): Promise<string | null> {
  const widths = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".tab-item")].map((tab) =>
      Math.round(tab.getBoundingClientRect().width),
    ),
  );
  if (widths.length === 0) return "no tabs";
  if (Math.max(...widths) - Math.min(...widths) > 1) return `widths differ: ${widths.join(", ")}`;
  if (Math.min(...widths) < minimum) return `a tab is ${Math.min(...widths)}px, under ${minimum}px`;
  return null;
}

/** Twelve tabs, as a window left open for a day, with `first` on screen (the active tab). */
const crowdedWindow = (c: Context, first: Route, count = 12) =>
  JSON.stringify({
    v: 1,
    split: null,
    focus: 0,
    fraction: 0.5,
    areas: [
      {
        active: 0,
        tabs: [
          first,
          { name: "board", host: ALFA, projectId: c.ids.project },
          { name: "hub" },
          { name: "needs-you" },
          { name: "costs" },
          { name: "settings" },
          { name: "clients" },
          { name: "history", host: ALFA },
          { name: "host", host: ALFA },
          { name: "project", host: ALFA, projectId: c.ids.project },
          { name: "teams" },
          { name: "personas" },
        ]
          .slice(0, count)
          .map((route) => ({ route, pinned: false })),
      },
    ],
  });

/** Opens the demo on a window with twelve tabs: no `?route=`, which would start a fresh window. */
async function openCrowded(c: Context, first: Route, count = 12) {
  // Any page of the demo holds the window's storage; the first call starts on one.
  if (!c.page.url().startsWith(c.url)) await c.page.goto(c.url);
  await c.page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    ["flightdeck.workspace", crowdedWindow(c, first, count)],
  );
  const query = new URLSearchParams({ lang: c.lang, theme: "light", reconnect: "fast" });
  await c.page.goto(`${c.url}?${query}`);
  await c.page.waitForTimeout(1500);
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

/**
 * The Choose folder dialog (issue #99): the dialog does not scroll sideways, and every button of
 * its footer, with the reason a disabled one gives, is inside the dialog's box.
 */
async function folderDialogProblems(c: Context): Promise<string[]> {
  await open(c, { name: "new-session", host: ALFA });
  await c.page.getByRole("button", { name: c.t("folderPicker.browse"), exact: true }).click();
  const dialog = c.page.getByRole("dialog", { name: c.t("folderPicker.title") });
  await dialog.waitFor({ timeout: WAIT });
  await dialog.getByRole("list", { name: c.t("folderPicker.list") }).waitFor({ timeout: WAIT });
  const system = c.t("folderPicker.system");
  return dialog.evaluate((box, systemLabel) => {
    // The demo runs in a browser, which has no system dialog and short folder names: add what the
    // desktop app shows (the button with its real label, a folder with a very long name).
    const cancel = box.querySelector<HTMLElement>(
      "[data-slot='dialog-footer'] button[data-variant='outline']",
    );
    const extra = cancel?.cloneNode(true) as HTMLElement | undefined;
    if (cancel && extra) {
      extra.textContent = systemLabel;
      cancel.before(extra);
    }
    const row = box.querySelector<HTMLElement>("ul li");
    const long = row?.cloneNode(true) as HTMLElement | undefined;
    const label = long?.querySelector("button")?.lastElementChild ?? long?.querySelector("button");
    if (row && long && label) {
      label.textContent = "pasta-com-um-nome-muito-comprido-".repeat(8);
      row.before(long);
    }
    const found: string[] = [];
    if (box.scrollWidth > box.clientWidth + 1) found.push("a janela de pasta rola para o lado");
    const edge = box.getBoundingClientRect();
    for (const button of box.querySelectorAll<HTMLElement>("[data-slot='dialog-footer'] button")) {
      const at = button.getBoundingClientRect();
      if (at.left < edge.left - 1 || at.right > edge.right + 1) {
        found.push(`o botão "${button.textContent?.trim()}" sai da janela de pasta`);
      }
    }
    return found;
  }, system);
}

/**
 * The session's summary is a card of the header: its box ends where the conversation begins, folded
 * and open (issue #97). Returns what is wrong, or null.
 */
async function recapOverlap(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const recap = document.querySelector<HTMLElement>("[data-slot='recap']");
    const timeline = document.querySelector<HTMLElement>("[data-slot='timeline']");
    if (!recap) return "sem cartão do resumo";
    if (!timeline) return "sem a conversa";
    const [a, b] = [recap.getBoundingClientRect(), timeline.getBoundingClientRect()];
    if (a.height <= 0) return "o resumo não tem altura";
    return a.bottom <= b.top + 1
      ? null
      : `o resumo (${Math.round(a.top)}..${Math.round(a.bottom)}) passa por cima da conversa (começa em ${Math.round(b.top)})`;
  });
}

export async function layout(c: Context, problems: string[]) {
  const screens: Array<[string, Route]> = [
    ["hub", { name: "hub" }],
    ["precisa-de-voce", { name: "needs-you" }],
    ["sessao", { name: "session", host: ALFA, id: c.ids.idleSession }],
    ["board", { name: "board", host: ALFA, projectId: c.ids.project }],
    ["host", { name: "host", host: ALFA }],
    ["custos", { name: "costs" }],
    ["configuracoes", { name: "settings" }],
    ["clientes", { name: "clients" }],
    [
      "agente",
      { name: "agent", host: ALFA, projectId: c.ids.project, projectName: c.ids.projectName },
    ],
    ["historico", { name: "history", host: ALFA }],
  ];
  // Issue #103: with 12 tabs and a long worktree path, no screen scrolls the page sideways.
  const crowded: Array<[string, Route]> = [
    ["sessao-longa", { name: "session", host: ALFA, id: c.ids.longSession }],
    ["titulo-longo", { name: "session", host: ALFA, id: c.ids.longTitleSession }],
    ...screens,
  ];
  for (const viewport of OVERFLOW_VIEWPORTS) {
    await c.page.setViewportSize(viewport);
    for (const [name, route] of crowded) {
      await openCrowded(c, route);
      // A print of the crowded window on request (the hand-off of issue #103 shows it).
      if (process.env.E2E_PRINT_DIR && name === "sessao-longa" && viewport.width > 1500) {
        await c.page.screenshot({
          path: `${process.env.E2E_PRINT_DIR}/janela-lotada-${c.lang}.png`,
        });
      }
      const crumbs = await crumbsProblem(c.page);
      if (crumbs)
        problems.push(`${c.lang} ${viewport.width}x${viewport.height} ${name}: ${crumbs}`);
      const sideways = await pageScrollsSideways(c.page);
      if (sideways) {
        problems.push(
          `${c.lang} ${viewport.width}x${viewport.height} ${name} (12 abas): ${sideways}`,
        );
      }
    }
    // Equal widths with 12 tabs and with 2, and 12 never under 80px.
    await openCrowded(c, { name: "hub" });
    const crowdedTabs = await tabWidthsProblem(c.page, 80);
    if (crowdedTabs)
      problems.push(`${c.lang} ${viewport.width}x${viewport.height} 12 abas: ${crowdedTabs}`);
    await openCrowded(c, { name: "hub" }, 2);
    const fewTabs = await tabWidthsProblem(c.page, 80);
    if (fewTabs) problems.push(`${c.lang} ${viewport.width}x${viewport.height} 2 abas: ${fewTabs}`);
  }
  // The tab strip starts at the same x whatever the crumbs say ("Hosts > alfa" is wider than "Settings").
  const lefts: number[] = [];
  for (const [, route] of screens.filter(([n]) => n === "host" || n === "configuracoes")) {
    await open(c, route);
    const box = await c.page.locator(".header-tabs").first().boundingBox();
    if (box) lefts.push(Math.round(box.x));
  }
  if (new Set(lefts).size > 1) {
    problems.push(`${c.lang}: o início das abas muda com o título (${lefts.join(" ≠ ")})`);
  }
  for (const viewport of VIEWPORTS) {
    await c.page.setViewportSize(viewport);
    for (const [name, route] of screens) {
      await open(c, route);
      const where = `${c.lang} ${viewport.width}x${viewport.height} ${name}`;
      for (const issue of await overflow(c.page)) problems.push(`${where}: ${issue}`);
      if (name === "sessao") {
        // Both states of the card (the first time a session is seen it starts open): the summary
        // never overlaps the conversation, as found and after flipping it.
        const toggle = c.page.locator("[data-slot='recap'] button[aria-expanded]").first();
        const state = async () =>
          (await toggle.count()) > 0 && (await toggle.getAttribute("aria-expanded")) === "true"
            ? "aberto"
            : "fechado";
        const first = await recapOverlap(c.page);
        if (first) problems.push(`${where}: ${first} (${await state()})`);
        if ((await toggle.count()) > 0) {
          await toggle.click();
          const flipped = await recapOverlap(c.page);
          if (flipped) problems.push(`${where}: ${flipped} (${await state()})`);
        }
      }
    }
    for (const issue of await folderDialogProblems(c)) {
      problems.push(`${c.lang} ${viewport.width}x${viewport.height} pasta: ${issue}`);
    }
    await open(c, { name: "hub" });
    const hidden = await lastRowProblem(c.page);
    if (hidden) {
      problems.push(
        `${c.lang} ${viewport.width}x${viewport.height}: o fim da lista não aparece depois de rolar (${hidden})`,
      );
    }
  }
  // The smallest window the app allows (tauri.conf.json), where the longest labels are tightest.
  await c.page.setViewportSize({ width: 720, height: 480 });
  for (const issue of await folderDialogProblems(c)) {
    problems.push(`${c.lang} 720x480 pasta: ${issue}`);
  }
}
