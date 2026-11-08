/**
 * The e2e journeys (phase 10): twenty in a real browser against the seeded demo, in both
 * languages, and a layout check of the main screens at 1280x800 and 800x600 (nothing sticks out
 * sideways, and the end of the long list shows after scrolling). The runner is `@playwright/test`
 * (scripts/e2e/define-journeys.ts, one file per language); this file holds the journeys themselves.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Lang, translator } from "../../apps/desktop/src/i18n/index.ts";
import type { Route } from "../../apps/desktop/src/lib/router.ts";
import type { DemoIds } from "../demo-seed.ts";
import { DEMO_FAKE_KEY } from "../lib/demo-secret.ts";
import { DEMO_TELEPORT_SESSIONS } from "../lib/demo-teleport.ts";
import {
  CONTRACT_CARD,
  DANGER_SESSION,
  DEMO_CLOSED_TEAM,
  OVERFLOW_VIEWPORTS,
  REACH_VIEWPORTS,
} from "../lib/e2e-journeys.ts";
import { ensureOnline } from "../lib/e2e-online.ts";
import {
  BARS,
  confirmGaps,
  type Finding,
  findingKey,
  GAP_BOXES,
  GAPS,
  GUARD_SIZES,
  judge,
  KEY_REGIONS,
  layoutFindings,
  loadBaseline,
  PAGE_AREA,
  pinnedProblem,
  SCROLL_SIZES,
  SINGLE_SCROLL,
  waitForStable,
} from "../lib/layout-guards.ts";

const ALFA = "demo-alfa";
/** The name of the second demo host, as the sidebar and the forms show it. */
const BETA = "beta";
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

/**
 * Opens a screen of the demo; `prefs` stores the theme and language like the prints do, and `extra`
 * adds demo switches to the address (`update=<version>` makes the updater offer that version).
 */
export async function open(
  c: Context,
  route: Route,
  prefs = true,
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({ route: JSON.stringify(route), ...extra });
  if (prefs) {
    query.set("lang", c.lang);
    query.set("theme", "light");
  }
  // The prints keep the demo's long wait between attempts; a journey needs a lost first
  // connection to heal in seconds.
  query.set("reconnect", "fast");
  await c.page.goto(`${c.url}?${query}`);
  // Not a guess: the sidebar's host dots are drawn (the screens with one), the hosts answer, and
  // then the layout holds still. A screen without a sidebar (simple mode) has no dots to wait for.
  await c.page
    .getByRole("img", { name: /^(alfa|beta): / })
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  await ensureOnline({
    online: () => demoHostsOnline(c),
    reload: async () => {
      await c.page.reload();
    },
    sleep: (ms) => c.page.waitForTimeout(ms),
    now: () => Date.now(),
  });
  await c.page.evaluate(waitForStable, { frames: 3, maxMs: 5000, boxes: GAP_BOXES });
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

/** Unfolds More options on the New session screen: the name and the subfolder are under it (#1135). */
async function moreOptions(c: Context) {
  const toggle = c.page.getByRole("button", { name: c.t("newSession.moreOptions"), exact: true });
  // It opens by itself to show a remembered subfolder: a click then would fold it.
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** Starts a session of the fake runtime from the New session screen. */
export async function createSession(c: Context, prompt: string, name?: string) {
  await open(c, { name: "new-session", host: ALFA });
  if (name) {
    await moreOptions(c);
    await c.page.getByLabel(c.t("newSession.name"), { exact: false }).fill(name);
  }
  await c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt);
  await c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click();
}

/**
 * Clicks `trigger` until `expected` shows. For a click whose result is the page's own state (a
 * dialog): a page drawn again in between drops it, and one more click brings it back. Gives up
 * after a few tries and lets the caller's own wait name what is missing.
 */
export async function clickUntil(trigger: Locator, expected: Locator, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    // Late, not lost: a dialog that came after the wait hides the trigger behind it.
    if ((await expected.count()) > 0) return;
    await trigger.click();
    const shown = await expected.waitFor({ timeout: 4000 }).then(
      () => true,
      () => false,
    );
    if (shown) return;
  }
}

/**
 * Where a session opened, measured until it holds (the view follows the end while the timeline
 * fills, so the first reading can be a few lines short): null once it is right, or the last
 * reading when it never is within the wait (#747).
 */
export async function pinnedOnceSettled(page: Page): Promise<string | null> {
  const deadline = Date.now() + WAIT;
  let reading = await page.evaluate(pinnedProblem);
  while (reading !== null && Date.now() < deadline) {
    await page.waitForTimeout(150);
    reading = await page.evaluate(pinnedProblem);
  }
  return reading;
}

export async function waitFor(check: () => Promise<boolean>, what: string, timeout = WAIT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`esperava: ${what}`);
}

/**
 * The screen's main action is inside the window as the page settles (nothing scrolled it there) and
 * can take a click: the #731 and #732 class of bug, where it sat below the fold (#754).
 */
export async function inReach(c: Context, what: string, button: Locator) {
  await button.waitFor({ timeout: WAIT });
  let seen = "";
  const fits = async () => {
    const size = c.page.viewportSize();
    const box = await button.boundingBox();
    seen = `${JSON.stringify(box)} in ${size?.width}x${size?.height}`;
    return (
      size !== null &&
      box !== null &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= size.width + 0.5 &&
      box.y + box.height <= size.height + 0.5
    );
  };
  await waitFor(fits, `${what} dentro da janela`).catch((error) => {
    throw new Error(`${error.message}: ${seen}`);
  });
  await button.click({ trial: true, timeout: WAIT });
}

export const journeys: Record<string, (c: Context) => Promise<void>> = {
  // 1. Approve a Bash request from the queue with the A key and see the queue shrink.
  "aprovar-bash-com-a": async (c) => {
    // The demo's seeded requests run out after a few runs, so the journey asks for its own.
    const session = `Aprovar e2e ${Date.now()}`;
    await createSession(c, "[bash] ls", session);
    await open(c, { name: "needs-you" });
    // A request's row says its tool; the session's finished turn, listed under Finished once the
    // request is answered, has the same name and must not count as the request.
    const row = c.page.locator(`main ul li button[aria-label*="${session}: Bash"]`);
    await row.first().click({ timeout: SESSION_WAIT });
    const card = c.page.locator("fieldset[data-request-id]").first();
    await card.waitFor({ timeout: WAIT });
    await card.focus();
    await c.page.keyboard.press("a");
    await waitFor(async () => (await row.count()) === 0, "o pedido saiu da fila");
  },

  // 1b. Issue #187 (J4): two requests answered with A and nothing else. Choosing the first puts the
  // focus on its card, and once it is answered the next one is chosen and focused.
  "responder-sem-clique": async (c) => {
    const stamp = Date.now();
    const first = `J4 primeira ${stamp}`;
    const second = `J4 segunda ${stamp}`;
    await createSession(c, "[bash] ls", first);
    await createSession(c, "[bash] ls", second);
    await open(c, { name: "needs-you" });
    // Only the request's row: the finished turn listed under Finished has the same name.
    const row = (name: string) => c.page.locator(`main ul li button[aria-label*="${name}: Bash"]`);
    await row(first).first().click({ timeout: SESSION_WAIT });
    await row(second).first().waitFor({ timeout: SESSION_WAIT });
    const focusedCard = () =>
      c.page.evaluate(() => Boolean(document.activeElement?.closest("fieldset[data-request-id]")));
    await waitFor(focusedCard, "o card do pedido escolhido tem o foco");
    await c.page.keyboard.press("a");
    await waitFor(async () => (await row(first).count()) === 0, "a primeira saiu da fila");
    await waitFor(focusedCard, "o card do próximo pedido tem o foco");
    await c.page.keyboard.press("a");
    await waitFor(async () => (await row(second).count()) === 0, "a segunda saiu da fila");
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
    // Issue #188: the creation says so (the toast is short-lived: look for it first), with a way
    // to the new card.
    await c.page
      .getByText(c.t("kanban.created", { title }), { exact: true })
      .waitFor({ timeout: WAIT });
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
    // The palette leaves on Esc and on a click outside (issue #566).
    const palette = c.page.getByRole("dialog", { name: c.t("searchUi.label") });
    await c.page.keyboard.press("Control+K");
    await palette.waitFor({ timeout: WAIT });
    await c.page.keyboard.press("Escape");
    await palette.waitFor({ state: "hidden", timeout: WAIT });
    await c.page.keyboard.press("Control+K");
    await palette.waitFor({ timeout: WAIT });
    await c.page.locator("body").click({ position: { x: 3, y: 3 } });
    await palette.waitFor({ state: "hidden", timeout: WAIT });
    await c.page.keyboard.press("Control+K");
    const input = c.page.getByLabel(c.t("searchUi.input"), { exact: true });
    await input.fill("revisão do arquivo");
    await input.press("Enter");
    const hit = c.page
      .getByRole("list", { name: c.t("searchUi.results") })
      .getByRole("button")
      .first();
    await hit.waitFor({ timeout: WAIT });
    // Long rows end in an ellipsis: the window never scrolls sideways.
    expect(await palette.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
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
    // The Sessions page starts with every project folded (issue #241): open them, so the rows are
    // there to count, and count only the page's own rows (the sidebar has list items too).
    await c.page.getByRole("button", { name: c.t("hub.expandAll"), exact: true }).click();
    const sessions = c.page.getByRole("main").locator("li[aria-label]");
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
    // The menu's Start asks for the workflow and persona first (issue #188).
    await c.page
      .getByRole("dialog", { name: c.t("board.startCard") })
      .getByRole("button", { name: c.t("cardUi.start"), exact: true })
      .click();
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
    await c.page
      .getByRole("dialog", { name: c.t("searchUi.label") })
      .getByRole("option", { name: c.t("palette.addHost"), exact: true })
      .click();
    await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).waitFor({ timeout: WAIT });
  },

  // 18. New session (issue #186): the Sessions list starts one, and the form lets the host be chosen.
  "nova-sessao-host": async (c) => {
    await open(c, { name: "hub" });
    // The header of the list; the sidebar has a button of the same name outside <main>.
    await c.page
      .getByRole("main")
      .locator('[data-slot="page-actions"]')
      .getByRole("button", { name: c.t("sidebar.newSession"), exact: true })
      .click();
    const host = c.page.getByLabel(c.t("newSession.host"), { exact: true });
    await host.waitFor({ timeout: WAIT });
    await host.selectOption({ label: BETA });
    await c.page
      .getByRole("heading", { name: c.t("newSession.title", { host: BETA }) })
      .waitFor({ timeout: WAIT });
  },

  // 20. A phone-notice webhook (issue #263): ntfy is a type of its own, a URL that names no topic
  // is refused with its reason, a topic URL is saved, and the list shows the type and only the
  // host the notices go to: the topic is a secret and never shown again.
  "webhook-ntfy": async (c) => {
    const name = `e2e-ntfy-${c.lang}-${Date.now()}`;
    const topic = `fd-e2e-${c.lang}-${Date.now()}`;
    await open(c, { name: "settings" });
    const form = c.page.getByRole("form", { name: c.t("webhooks.add"), exact: true });
    await form.waitFor({ timeout: WAIT });
    await form.getByLabel(c.t("webhooks.name"), { exact: true }).fill(name);
    await form.getByLabel(c.t("webhooks.type"), { exact: true }).selectOption("ntfy");
    // The field is a topic URL now, with its help, and the events are the person's pick.
    const url = form.getByLabel(c.t("webhooks.ntfyUrl"), { exact: true });
    await url.fill("https://ntfy.sh/");
    await form.getByText(c.t("webhooks.ntfyHelp"), { exact: true }).waitFor({ timeout: WAIT });
    await form.getByLabel(c.t("webhooks.kind.needs_you"), { exact: true }).check();
    await form.getByRole("button", { name: c.t("webhooks.save"), exact: true }).click();
    await c.page
      .getByText(c.t("webhooks.errors.invalid_topic"), { exact: true })
      .waitFor({ timeout: WAIT });
    await url.fill(`https://ntfy.sh/${topic}`);
    await form.getByRole("button", { name: c.t("webhooks.save"), exact: true }).click();
    const row = c.page.locator("li", { hasText: name });
    await row.waitFor({ timeout: WAIT });
    await row.getByText(c.t("webhooks.types.ntfy"), { exact: true }).waitFor({ timeout: WAIT });
    await row
      .getByText(c.t("webhooks.sendsTo", { host: "ntfy.sh" }), { exact: true })
      .waitFor({ timeout: WAIT });
    await waitFor(
      async () => (await c.page.getByText(topic).count()) === 0,
      "o tópico não aparece na lista",
    );
  },

  // 21. The update card (issue #490): once a new version is downloaded, a card offers to update,
  // says the sessions are not interrupted, links the release notes and goes away when closed.
  "update-card": async (c) => {
    await open(c, { name: "hub" }, true, { update: "9.9.9" });
    const card = c.page.getByRole("region", { name: c.t("update.cardTitle"), exact: true });
    await card.waitFor({ timeout: WAIT });
    await card.getByText(c.t("update.cardReady", { version: "9.9.9" }), { exact: true }).waitFor({
      timeout: WAIT,
    });
    await card.getByText(c.t("update.cardSafe"), { exact: true }).waitFor({ timeout: WAIT });
    const notes = card.getByRole("link", { name: c.t("update.cardNotes"), exact: true });
    expect(await notes.getAttribute("href")).toBe(
      "https://github.com/jnerytech/flightdeck/releases/tag/v9.9.9",
    );
    await card.getByRole("button", { name: c.t("update.cardUpdate"), exact: true }).waitFor({
      timeout: WAIT,
    });
    // Issue #581: a toast that comes while the card shows sits above it, clear of it and of the
    // status bar.
    await c.page.evaluate(() => window.dispatchEvent(new Event("flightdeck:demo-toast")));
    await c.page
      .locator('[data-sonner-toast][data-mounted="true"]')
      .first()
      .waitFor({ timeout: WAIT });
    await expect
      .poll(
        async () =>
          (await c.page.evaluate(layoutFindings, { gaps: GAPS }))
            .filter((finding) => finding.rule === "gap")
            .map((finding) => `${finding.path}: ${finding.detail}`),
        { timeout: WAIT },
      )
      .toEqual([]);
    await card.getByRole("button", { name: c.t("update.cardClose"), exact: true }).click();
    await card.waitFor({ state: "detached", timeout: WAIT });
  },

  // 22. The status bar (issue #491): it counts the hosts and the terminals, and its keep-awake item
  // (on or holding the computer awake) opens the host's setting for it.
  "status-bar": async (c) => {
    await open(c, { name: "hub" });
    const bar = c.page.getByRole("region", { name: c.t("statusBar.label"), exact: true });
    await bar.waitFor({ timeout: WAIT });
    const pattern = (key: "statusBar.hosts" | "statusBar.terminals") => {
      const text = c.t(key, { online: "@1", total: "@2", n: "@1" });
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped.replace("@1", "\\d+").replace("@2", "\\d+")}$`);
    };
    await bar.getByRole("button", { name: pattern("statusBar.hosts") }).waitFor({ timeout: WAIT });
    await bar
      .getByRole("button", { name: pattern("statusBar.terminals") })
      .or(bar.getByRole("button", { name: c.t("statusBar.terminalsOne"), exact: true }))
      .first()
      .waitFor({ timeout: WAIT });
    const awake = (state: "on" | "off" | "holding") =>
      bar.getByRole("button", { name: c.t(`statusBar.keepAwake.${state}`), exact: true });
    const holdsOn = awake("on").or(awake("holding"));
    await holdsOn.first().click({ timeout: WAIT });
    await c.page
      .getByRole("tab", { name: c.t("hostHome.settings"), exact: true })
      .click({ timeout: WAIT });
    await c.page
      .getByText(c.t("hostPage.keepAwakeTitle"), { exact: true })
      .waitFor({ timeout: WAIT });
  },

  // 23. Revoking a project's trust (issue #463): a session that started while the project was
  // trusted keeps the hooks and MCP servers it loaded, says so and offers to restart; the restart
  // clears the notice. The journey ends with the project untrusted again, as the demo seeds it.
  "trust-revoke": async (c) => {
    const project = { name: "project", host: ALFA, projectId: c.ids.project } as const;
    await open(c, project);
    const revoke = c.page.getByRole("button", {
      name: c.t("projectPage.trust.revoke"),
      exact: true,
    });
    const trust = c.page.getByRole("button", {
      name: c.t("projectPage.trust.action"),
      exact: true,
    });
    // A run that stopped half way left the project trusted: start from the same place anyway.
    await trust.or(revoke).first().waitFor({ timeout: WAIT });
    if ((await revoke.count()) === 0) {
      await trust.click();
      await c.page
        .getByRole("alertdialog")
        .getByRole("button", { name: c.t("projectPage.trust.action"), exact: true })
        .click();
      await revoke.waitFor({ timeout: WAIT });
    }
    // A session started inside the trusted folder loads the project's setup. It waits for an
    // answer, so the run is still alive when the trust is removed.
    const name = `e2e-revoga-${c.lang}-${Date.now()}`;
    await open(c, { name: "new-session", host: ALFA });
    await moreOptions(c);
    await c.page.getByLabel(c.t("newSession.subfolder"), { exact: true }).fill("flightdeck-web");
    await c.page.getByLabel(c.t("newSession.name"), { exact: false }).fill(name);
    await c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill("[bash] ls");
    await c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click();
    const row = c.page.locator("main ul li button", { hasText: name });
    await open(c, { name: "needs-you" });
    await row.first().waitFor({ timeout: SESSION_WAIT });
    // Removing the trust leaves that session as it is, and tells the person to restart it.
    await open(c, project);
    await revoke.waitFor({ timeout: WAIT });
    await revoke.click();
    await trust.waitFor({ timeout: WAIT });
    await open(c, { name: "needs-you" });
    await row.first().click({ timeout: SESSION_WAIT });
    await c.page.getByRole("button", { name: c.t("approval.openSession"), exact: true }).click();
    const notice = c.page.getByText(c.t("projectPage.trust.revokedNotice"));
    await notice.waitFor({ timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("projectPage.trust.restart"), exact: true })
      .click();
    await notice.waitFor({ state: "detached", timeout: SESSION_WAIT });
  },

  // Project knowledge (issue #76): the library lists its documents with the status each one says
  // it has, a filter narrows the list, the status select edits the document and the counts follow,
  // and the feed switch turns the index for sessions off and on. The demo keeps its state, so the
  // journey puts the status and the switch back where it found them.
  "knowledge-panel": async (c) => {
    await open(c, { name: "project", host: ALFA, projectId: c.ids.knowledgeProject });
    const panel = c.page.getByRole("region", {
      name: c.t("projectPage.knowledge.title"),
      exact: true,
    });
    const word = (status: "valid" | "transitional" | "obsolete") =>
      c.t(`projectPage.knowledge.status.${status}`);
    const filter = (status: "valid" | "transitional" | "obsolete", n: number) =>
      panel.getByRole("button", {
        name: c.t("projectPage.knowledge.filter", { status: word(status), n }),
        exact: true,
      });
    const titles = {
      valid: "Design tokens come from one file",
      transitional: "Dark mode for every screen",
      obsolete: "A fixed twelve column grid",
    } as const;
    const listed = (title: string) => panel.getByText(title, { exact: true });
    for (const title of Object.values(titles)) await listed(title).waitFor({ timeout: WAIT });
    // A filter keeps the documents of one status.
    await filter("obsolete", 1).click();
    await listed(titles.valid).waitFor({ state: "detached", timeout: WAIT });
    await listed(titles.obsolete).waitFor({ timeout: WAIT });
    await panel
      .getByRole("button", {
        name: c.t("projectPage.knowledge.filter", {
          status: c.t("projectPage.knowledge.all"),
          n: 3,
        }),
        exact: true,
      })
      .click();
    await listed(titles.valid).waitFor({ timeout: WAIT });
    // The status changes in the document's file, and the counts follow it.
    const select = (title: string) =>
      panel.getByLabel(c.t("projectPage.knowledge.setStatus.label", { title }), { exact: true });
    const apply = (title: string) =>
      panel.getByRole("button", {
        name: c.t("projectPage.knowledge.setStatus.applyLabel", { title }),
        exact: true,
      });
    await select(titles.obsolete).selectOption({ label: word("valid") });
    await apply(titles.obsolete).click();
    await panel
      .getByRole("status")
      .filter({
        hasText: c.t("projectPage.knowledge.setStatus.changed", {
          title: titles.obsolete,
          status: word("valid"),
        }),
      })
      .waitFor({ timeout: WAIT });
    await filter("valid", 2).waitFor({ timeout: WAIT });
    await select(titles.obsolete).selectOption({ label: word("obsolete") });
    await apply(titles.obsolete).click();
    await filter("obsolete", 1).waitFor({ timeout: WAIT });
    // The index for sessions: off, then on again. The demo's project is not trusted, so "on" reads
    // as the untrusted kind of on.
    const on = panel
      .getByText(c.t("projectPage.knowledge.feed.on"), { exact: true })
      .or(panel.getByText(c.t("projectPage.knowledge.feed.onUntrusted"), { exact: true }));
    await on.first().waitFor({ timeout: WAIT });
    await panel
      .getByRole("button", { name: c.t("projectPage.knowledge.feed.turnOff"), exact: true })
      .click();
    await panel
      .getByText(c.t("projectPage.knowledge.feed.off"), { exact: true })
      .waitFor({ timeout: WAIT });
    await panel
      .getByRole("button", { name: c.t("projectPage.knowledge.feed.turnOn"), exact: true })
      .click();
    await on.first().waitFor({ timeout: WAIT });
  },

  // Stage contracts (issue #78): Review asks for a PR, so moving a card that has none asks first.
  // Cancel leaves the card where it was; Move anyway moves it, and the card says what it lacked.
  // The journey puts the card back, as the demo keeps its state.
  "stage-contract": async (c) => {
    await open(c, { name: "board", host: ALFA, projectId: c.ids.knowledgeProject });
    const column = (id: string) => c.page.locator(`[data-column="${id}"]`);
    const tile = (id: string) =>
      column(id).locator(`li[aria-label="${c.t("kanban.card", { title: CONTRACT_CARD })}"]`);
    const moveTo = async (from: string, to: string) => {
      await tile(from)
        .getByRole("button", {
          name: c.t("board.cardActions", { title: CONTRACT_CARD }),
          exact: true,
        })
        .click();
      await c.page
        .getByRole("menuitem", {
          name: c.t("board.moveTo", { column: c.t(`kanban.columns.${to}` as never) }),
          exact: true,
        })
        .click();
    };
    // A run that stopped half way left the card in Review: start from the same place anyway.
    await tile("backlog").or(tile("review")).first().waitFor({ timeout: WAIT });
    if ((await tile("backlog").count()) === 0) {
      await moveTo("review", "backlog");
      await tile("backlog").waitFor({ timeout: WAIT });
    }
    const dialog = c.page.getByRole("alertdialog", {
      name: c.t("board.contract.title", { column: c.t("kanban.columns.review") }),
    });
    await moveTo("backlog", "review");
    await dialog
      .getByText(c.t("board.contract.needs.pr"), { exact: false })
      .waitFor({ timeout: WAIT });
    // Cancel: nothing moved.
    await dialog.getByRole("button", { name: c.t("common.cancel"), exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: WAIT });
    if ((await tile("review").count()) !== 0) {
      throw new Error("stage-contract: Cancel moved the card");
    }
    // Move anyway: the card is in Review, and its notice says what it lacked.
    await moveTo("backlog", "review");
    await dialog
      .getByRole("button", { name: c.t("board.contract.moveAnyway"), exact: true })
      .click();
    await tile("review").waitFor({ timeout: WAIT });
    await tile("review")
      .getByText(c.t("board.contract.needs.pr"), { exact: false })
      .first()
      .waitFor({ timeout: WAIT });
    // Back to the backlog, which asks nothing.
    await moveTo("review", "backlog");
    await tile("backlog").waitFor({ timeout: WAIT });
  },

  // Card pins (issue #76): a card pins a document of the project's library, the pin shows with its
  // title, path and status, and Unpin takes it away. The journey ends with nothing pinned, as the
  // demo keeps its state.
  "card-pins": async (c) => {
    await open(c, {
      name: "card",
      host: ALFA,
      projectId: c.ids.knowledgeProject,
      cardId: c.ids.contractCard,
    });
    const panel = c.page.getByRole("region", { name: c.t("cardUi.pins.title"), exact: true });
    const none = panel.getByText(c.t("cardUi.pins.none"), { exact: true });
    const path = "docs/adr/0001-design-tokens.md";
    const unpin = panel.getByRole("button", {
      name: c.t("cardUi.pins.unpin", { path }),
      exact: true,
    });
    // A run that stopped half way left the pin: start from the same place anyway.
    await none.or(unpin).first().waitFor({ timeout: WAIT });
    if ((await unpin.count()) > 0) {
      await unpin.click();
      await none.waitFor({ timeout: WAIT });
    }
    await panel.getByLabel(c.t("cardUi.pins.pick"), { exact: true }).selectOption(path);
    // Choosing only picks (#1088): Pin pins it.
    await panel.getByRole("button", { name: c.t("cardUi.pins.pinAction"), exact: true }).click();
    await unpin.waitFor({ timeout: WAIT });
    await panel
      .getByText("Design tokens come from one file", { exact: true })
      .waitFor({ timeout: WAIT });
    await none.waitFor({ state: "detached", timeout: WAIT });
    await unpin.click();
    await none.waitFor({ timeout: WAIT });
  },

  // Workflow templates (issue #79): Add from a template lists the templates, a template opens with
  // where to commit it and the file itself, Copy puts the file on the clipboard and says so, and
  // Back returns to the list. Nothing is written to the project.
  "workflow-templates": async (c) => {
    await c.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(c, {
      name: "workflows",
      host: ALFA,
      projectId: c.ids.project,
      projectName: c.ids.projectName,
    });
    await c.page
      .getByRole("button", { name: c.t("workflowsUi.templates.open"), exact: true })
      .click();
    const dialog = c.page.getByRole("dialog", { name: c.t("workflowsUi.templates.title") });
    await dialog.waitFor({ timeout: WAIT });
    // The first template of the list, whatever its name: "Show <name>" in the language of the app.
    const show = c.t("workflowsUi.templates.show", { name: "\u0000" }).split("\u0000")[0] ?? "";
    const templates = dialog.getByRole("button").filter({ hasText: show });
    await templates.first().click();
    const copy = dialog.getByRole("button", {
      name: c.t("workflowsUi.templates.copy"),
      exact: true,
    });
    await copy.waitFor({ timeout: WAIT });
    await copy.click();
    await dialog
      .getByText(c.t("workflowsUi.templates.copied"), { exact: true })
      .waitFor({ timeout: WAIT });
    const copied = await c.page.evaluate(() => navigator.clipboard.readText());
    if (!copied.includes("steps")) {
      throw new Error("workflow-templates: the clipboard has no workflow file");
    }
    await dialog
      .getByRole("button", { name: c.t("workflowsUi.templates.back"), exact: true })
      .click();
    await templates.first().waitFor({ timeout: WAIT });
  },

  // The mode chip (issues #935, #961): the chip under the composer names the session's permission
  // mode, its menu changes the mode, and a page opened again still shows the mode the session has
  // (it once said Default for a session in plan mode). The journey puts the mode back to Default.
  "mode-chip": async (c) => {
    const route = { name: "session", host: ALFA, id: c.ids.idleSession } as const;
    const chip = (mode: "default" | "plan") =>
      c.page.getByRole("button", {
        name: c.t("session.modeChip", { mode: c.t(`modes.${mode}.name`) }),
        exact: true,
      });
    const pick = async (from: "default" | "plan", to: "default" | "plan") => {
      await chip(from).click();
      await c.page
        .getByRole("menuitemradio", { name: new RegExp(`^${c.t(`modes.${to}.name`)}`) })
        .click();
      await chip(to).waitFor({ timeout: WAIT });
    };
    await open(c, route);
    // A run that stopped half way left the session in plan mode: start from the same place anyway.
    await chip("default").or(chip("plan")).first().waitFor({ timeout: WAIT });
    if ((await chip("plan").count()) > 0) await pick("plan", "default");
    await pick("default", "plan");
    // Opened again, the page shows the mode the session has, not the one it started with.
    await open(c, route);
    await chip("plan").waitFor({ timeout: WAIT });
    await pick("plan", "default");
  },

  // 25. The Files tab of a session opens a file read only; when the session rewrites it (a second
  // window sends the message) the open file offers its diff, live, and the diff toggles back (#506).
  // The demo keeps its state: after the first run README.md is already changed, so only a fresh
  // demo proves that the button arrives by itself.
  "files-viewer": async (c) => {
    const route: Route = { name: "session", host: ALFA, id: c.ids.idleSession };
    await open(c, route);
    await c.page.getByRole("tab", { name: c.t("files.tab"), exact: true }).click();
    const tree = c.page.getByRole("region", { name: c.t("files.region"), exact: true });
    await tree.getByRole("button", { name: "README.md", exact: true }).click();
    const viewer = c.page.getByRole("region", { name: c.t("files.viewer", { path: "README.md" }) });
    // The demo keeps what an earlier run rewrote: any line of the file shows it opened.
    await viewer.locator(".cm-line").first().waitFor({ timeout: WAIT });
    const other = await c.page.context().newPage();
    try {
      await open({ ...c, page: other }, route);
      // The tab the first window picked is remembered by the browser: this one starts on the conversation.
      await other.getByRole("tab", { name: c.t("changes.conversationTab"), exact: true }).click();
      const box = other.getByLabel(c.t("session.message"), { exact: true });
      await box.fill("[result:README.md] reescreva o arquivo");
      await box.press("Enter");
      // The sent message is on screen: the daemon has it, and the first window learns the rest by itself.
      await other
        .getByText("[result:README.md]", { exact: false })
        .first()
        .waitFor({ timeout: WAIT });
    } finally {
      await other.close();
    }
    const changes = viewer.getByRole("button", { name: c.t("files.showChanges"), exact: true });
    await changes.click({ timeout: WAIT * 2 });
    await c.page.getByRole("region", { name: c.t("diff.unifiedLabel") }).waitFor({ timeout: WAIT });
    await viewer.getByRole("button", { name: c.t("files.showFile"), exact: true }).click();
    await viewer.locator(".cm-content").waitFor({ timeout: WAIT });
    await viewer.getByRole("button", { name: c.t("files.close"), exact: true }).click();
    await viewer.waitFor({ state: "detached", timeout: WAIT });
  },

  // 24. In the host terminal: a selection can be copied from the menu (#475), and Shift+Enter alone
  // sends ESC then CR, the new line Claude Code reads, while a plain Enter does not (#485).
  "terminal-copy": async (c) => {
    const marker = `fd-${c.lang}-${Date.now()}`;
    const rows = c.page.locator(".xterm-rows");
    const screen = async () => (await rows.first().textContent()) ?? "";
    await c.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(c, { name: "host", host: ALFA });
    await c.page
      .getByRole("tab", { name: c.t("hostHome.settings"), exact: true })
      .first()
      .click();
    await c.page.getByRole("button", { name: c.t("hostTerminal.open"), exact: true }).click();
    await c.page
      .getByText(c.t("terminalUi.state.live"), { exact: true })
      .waitFor({ timeout: WAIT });
    // The shell draws its prompt before it reads: type only after something is on the screen.
    await waitFor(async () => (await screen()).trim() !== "", "o prompt do shell");
    await c.page.locator(".xterm").first().click();
    await c.page.keyboard.type("PS1='$ '\n");
    await c.page.keyboard.type(`echo ${marker}\n`);
    await waitFor(
      async () => (await screen()).split(marker).length - 1 >= 2,
      "o eco do terminal",
      WAIT * 2,
    );

    // Copy is off with nothing selected, and on after Select all: what the clipboard gets is the screen.
    const area = c.page.locator("[data-terminal-area]");
    const menu = c.page.getByRole("menu", { name: c.t("terminalUi.title"), exact: true });
    const copy = menu.getByRole("button", { name: c.t("terminalUi.copy"), exact: true });
    await area.click({ button: "right" });
    await copy.waitFor({ timeout: WAIT });
    if (await copy.isEnabled()) throw new Error("Copy deveria estar desligado sem seleção");
    await menu.getByRole("button", { name: c.t("terminalUi.selectAll"), exact: true }).click();
    await area.click({ button: "right" });
    await waitFor(async () => copy.isEnabled(), "o Copiar ligado depois de selecionar");
    await copy.click();
    await waitFor(
      async () => (await c.page.evaluate(() => navigator.clipboard.readText())).includes(marker),
      "o texto selecionado na área de transferência",
    );

    // An ESC shows as "^[" twice: the terminal's echo of the key, then cat -v printing the byte it read.
    await c.page.locator(".xterm").first().click();
    await c.page.keyboard.type("cat -v\n");
    await c.page.keyboard.press("Enter");
    const echoed = async () => (await screen()).split("^[").length - 1;
    if ((await echoed()) !== 0) throw new Error("o Enter simples não manda ESC");
    await c.page.keyboard.press("Shift+Enter");
    await waitFor(async () => (await echoed()) === 2, "o ESC do Shift+Enter");

    // Ends it: the demo keeps its state, and the other language's run lists only its own.
    await c.page.keyboard.press("Control+C");
    await c.page.getByRole("button", { name: c.t("terminalUi.close"), exact: true }).click();
    await c.page.getByRole("button", { name: c.t("terminalUi.end"), exact: true }).click();
  },

  // 25. An idle session sleeps from its row's menu and the hub marks it asleep; a message wakes it
  // from where it was, and the mark goes away (#157).
  "sleep-wake": async (c) => {
    // The first idle session of the demo: it answers again after it wakes, so it ends as it began.
    await open(c, { name: "hub" });
    await c.page.getByRole("button", { name: c.t("hub.expandAll"), exact: true }).click();
    const rows = c.page.getByRole("main").locator("li[aria-label]");
    const idle = rows.filter({
      has: c.page.getByRole("img", { name: c.t("hub.stateDots.idle"), exact: true }),
    });
    await idle.first().waitFor({ timeout: SESSION_WAIT });
    const title = (await idle.first().getAttribute("aria-label")) ?? "";
    // Two sessions can share a standard name, so the row is kept by its place among the rows: its
    // state, not its place, changes when it sleeps.
    const place = await idle
      .first()
      .evaluate((el) =>
        [...(el.closest("main")?.querySelectorAll("li[aria-label]") ?? [])].indexOf(el),
      );
    const row = rows.nth(place);
    const asleep = async () =>
      (await row.getByText(c.t("hub.asleep"), { exact: true }).count()) > 0;
    // A fresh page opens no session, so nobody has this one open and it may sleep.
    await row.getByRole("button", { name: c.t("hub.actions", { title }), exact: true }).click();
    await c.page.getByRole("menuitem", { name: c.t("hub.sleepNow"), exact: true }).click();
    await waitFor(asleep, "a sessão dormindo", SESSION_WAIT);
    // A message to the sleeping session wakes it: the runtime answers again.
    await row.getByRole("button", { name: title, exact: true }).click();
    const box = c.page.getByLabel(c.t("session.message"), { exact: true });
    const message = `acorde ${c.lang} ${Date.now()}`;
    await box.fill(message);
    await box.press("Enter");
    await c.page.getByText(`Echo: ${message}`).first().waitFor({ timeout: SESSION_WAIT });
    await waitFor(async () => !(await asleep()), "a sessão acordada", SESSION_WAIT);
  },

  // 26. The tab row (#488, #644): the shared Sessions tab first, with no ×, then the host's own two
  // tabs, only the active one selected and showing its ×, which the other shows on hover; closing the
  // active one leaves the other active; in a window under 600 px tall the tabs share the top bar's row.
  "tab-row": async (c) => {
    await open(c, { name: "hub" });
    await c.page
      .locator("aside")
      .first()
      .getByRole("button", { name: c.t("sidebar.openHost", { host: "alfa" }) })
      .click({ modifiers: ["Control"] });
    const bar = c.page.getByRole("tablist", { name: c.t("tabs.list"), exact: true });
    const tabs = bar.getByRole("tab");
    await waitFor(async () => (await tabs.count()) === 2, "duas abas");
    // A new tab is one more Overview of the host in use.
    await c.page.keyboard.press("Control+t");
    await c.page.keyboard.press("Escape");
    await waitFor(async () => (await tabs.count()) === 3, "três abas");
    const selected = async () =>
      (await tabs.evaluateAll((all) => all.map((tab) => tab.getAttribute("aria-selected")))).join();
    // The × of the nth tab is a sibling of the tab in its item, drawn invisible until it is wanted.
    const cross = (n: number) =>
      c.page.locator(".tab-item").nth(n).locator("button[tabindex='-1']");
    const shown = async (n: number) =>
      Number(await cross(n).evaluate((el) => getComputedStyle(el).opacity)) > 0.5;
    // The shared tab belongs to no host: it has no ×.
    if ((await cross(0).count()) !== 0) throw new Error("a aba compartilhada não devia ter ×");
    const picked = (await selected()).split(",").indexOf("true");
    if (picked < 1 || (await selected()).split(",").filter((s) => s === "true").length !== 1) {
      throw new Error(`uma única aba do host ativa era esperado, veio: ${await selected()}`);
    }
    const other = picked === 1 ? 2 : 1;
    if (!(await shown(picked))) throw new Error("a aba ativa devia mostrar o ×");
    if (await shown(other)) throw new Error("a aba inativa devia esconder o ×");
    await tabs.nth(other).hover();
    await waitFor(() => shown(other), "o × da aba inativa ao passar o mouse");
    // Another tab becomes the active one.
    await tabs.nth(other).click();
    await waitFor(async () => (await selected()).split(",")[other] === "true", "a outra aba ativa");
    // Closing the active tab leaves the other one, active.
    await cross(other).click();
    await waitFor(async () => (await tabs.count()) === 2, "duas abas depois de fechar");
    if ((await selected()).split(",")[1] !== "true") {
      throw new Error("a aba do host que sobrou devia estar ativa");
    }
    // In a window under 600 px tall the area's tabs share the top bar's row.
    // Where the strip sits is read in the page: a locator that finds nothing would wait for the whole test.
    const inHeader = () =>
      c.page.evaluate(() => {
        const strip = document.querySelector('[role="tablist"]');
        const header = document.querySelector("header");
        return strip === null || header === null ? null : header.contains(strip);
      });
    if ((await inHeader()) !== false) throw new Error("em janela alta as abas têm linha própria");
    await c.page.setViewportSize({ width: 720, height: 480 });
    await waitFor(async () => (await inHeader()) === true, "as abas na linha da barra do topo");
  },

  // 27. The wand on the message box (#158): Settings sends the text through a host only after the
  // person agrees; then the wand improves what was typed, Accept replaces it, Undo puts it back.
  // The demo's fake assistant answers "improved: <text>".
  "wand-composer": async (c) => {
    await open(c, { name: "settings" });
    await c.page.getByRole("radio", { name: c.t("assistantSettings.host"), exact: true }).click();
    const agree = c.page
      .getByRole("alertdialog")
      .getByRole("button", { name: c.t("assistantSettings.hostConfirmYes", { host: "alfa" }) })
      .or(
        c.page
          .getByRole("alertdialog")
          .getByRole("button", { name: c.t("assistantSettings.hostConfirmYes", { host: "beta" }) }),
      );
    await agree.first().click({ timeout: WAIT });
    await c.page
      .getByRole("radio", { name: c.t("assistantSettings.host"), exact: true })
      .and(c.page.locator(":checked"))
      .waitFor({ timeout: WAIT });
    await open(c, { name: "session", host: ALFA, id: c.ids.idleSession });
    const box = c.page.getByLabel(c.t("session.message"), { exact: true });
    const typed = `escreva melhor ${c.lang}`;
    await box.fill(typed);
    await c.page.getByRole("button", { name: c.t("assistantWand.improve"), exact: true }).click();
    // The suggestion: what was there, and what would replace it.
    const preview = c.page.getByRole("dialog", { name: c.t("assistantWand.preview"), exact: true });
    await preview.waitFor({ timeout: SESSION_WAIT });
    await preview.getByText(`improved: ${typed}`).first().waitFor({ timeout: WAIT });
    if ((await box.inputValue()) !== typed) throw new Error("o texto mudou antes do Aceitar");
    await preview.getByRole("button", { name: c.t("assistantWand.accept"), exact: true }).click();
    await waitFor(async () => (await box.inputValue()) === `improved: ${typed}`, "o texto trocado");
    // Undo puts the old text back.
    await c.page.getByRole("button", { name: c.t("assistantWand.undo"), exact: true }).click();
    await waitFor(async () => (await box.inputValue()) === typed, "o texto de volta");
  },

  // 28. Notification preferences (#149): Settings switches an event off and mutes a host, both
  // survive a reload (they live in the app's own storage), the switches come back on, and the test
  // notification says whether the system showed it (a headless browser may refuse, so either
  // answer is right; what matters is that it answers).
  "notify-prefs": async (c) => {
    await open(c, { name: "settings" });
    // Settings has other switches with the same words (Needs you): these two groups are the panel's.
    const events = c.page.getByRole("group", { name: c.t("notifyPrefs.events"), exact: true });
    const mutes = c.page.getByRole("group", { name: c.t("notifyPrefs.mute"), exact: true });
    const box = (group: typeof events, name: string) =>
      group.getByRole("checkbox", { name, exact: true });
    const finished = box(events, c.t("notifyPrefs.event.turn-finished"));
    const muteAlfa = box(mutes, c.t("notifyPrefs.muteHost", { name: "alfa" }));
    await finished.scrollIntoViewIfNeeded({ timeout: WAIT });
    if (!(await finished.isChecked())) throw new Error("Turn finished começa ligado");
    if (await muteAlfa.isChecked()) throw new Error("alfa começa sem silêncio");
    await finished.uncheck();
    await muteAlfa.check();
    // The page is read again from the start: only what was stored can still be set.
    await open(c, { name: "settings" });
    await finished.scrollIntoViewIfNeeded({ timeout: WAIT });
    await waitFor(
      async () => !(await finished.isChecked()),
      "Turn finished desligado após recarregar",
    );
    await waitFor(async () => await muteAlfa.isChecked(), "alfa silenciado após recarregar");
    // The other switches were not touched.
    if (!(await box(events, c.t("notifyPrefs.event.needs-you")).isChecked())) {
      throw new Error("Needs you mudou sem ninguém pedir");
    }
    await finished.check();
    await muteAlfa.uncheck();
    await waitFor(
      async () => (await finished.isChecked()) && !(await muteAlfa.isChecked()),
      "as chaves de volta",
    );
    await c.page.getByRole("button", { name: c.t("notifyPrefs.test"), exact: true }).click();
    await c.page
      .getByText(new RegExp(`^(${c.t("notifyPrefs.delivered")}|${c.t("notifyPrefs.notShown")})`))
      .first()
      .waitFor({ timeout: WAIT });
  },

  // Issue #151: the Activity board puts the sessions of every host in columns by state. A request
  // is approved from its card, the filters narrow the cards and a card opens its session.
  activity: async (c) => {
    // The demo's seeded requests run out, so the journey asks for its own.
    await createSession(c, "[bash] ls", `Activity e2e ${c.lang} ${Date.now()}`);
    await open(c, { name: "activity" });
    const column = (name: string) => c.page.getByRole("region", { name, exact: true });
    const needs = column(c.t("activityBoard.columns.needs_you"));
    // A request waits in Needs you with its own buttons. The first card that has an Approve is
    // followed by its key (what the view transition names it), whatever else the demo has waiting.
    const approve = needs.getByRole("button", { name: c.t("activityBoard.approve"), exact: true });
    await approve.first().waitFor({ timeout: SESSION_WAIT });
    const approveButton = c.page.getByRole("button", {
      name: c.t("activityBoard.approve"),
      exact: true,
    });
    const top = needs.locator("[data-slot='activity-card']").filter({ has: approveButton }).first();
    const key = await top.evaluate((el) => (el as HTMLElement).style.viewTransitionName);
    if (!key) throw new Error("o card do pedido não tem nome de transição");
    const mine = needs.locator(`[data-slot='activity-card'][style*="${key}"]`);
    await mine.getByRole("button", { name: c.t("activityBoard.approve"), exact: true }).click();
    await waitFor(
      async () =>
        (await mine
          .getByRole("button", { name: c.t("activityBoard.approve"), exact: true })
          .count()) === 0,
      "o pedido aprovado saiu de Precisa de você",
      SESSION_WAIT,
    );
    // The search narrows to nothing and back; the line says how many are shown.
    const shown = c.page.locator("output[class*='activity-shown']");
    const search = c.page.getByRole("searchbox", {
      name: c.t("activityBoard.search"),
      exact: true,
    });
    const total = (await shown.textContent()) ?? "";
    if (total === "" || total.startsWith("0 "))
      throw new Error(`a linha de contagem diz "${total}"`);
    await search.fill("zz-no-such-session-zz");
    await waitFor(
      async () => ((await shown.textContent()) ?? "").startsWith("0 "),
      "nenhum card mostrado",
    );
    await search.fill("");
    await waitFor(
      async () => !((await shown.textContent()) ?? "0 ").startsWith("0 "),
      "os cards de volta",
    );
    // Idle waits for its switch.
    const idle = column(c.t("activityBoard.columns.idle"));
    if ((await idle.count()) !== 0) throw new Error("Ociosas apareceu sem o botão");
    await c.page
      .getByRole("checkbox", { name: c.t("activityBoard.showIdle"), exact: true })
      .check();
    await idle.waitFor({ timeout: WAIT });
    // A card opens its session: the board is gone.
    await c.page
      .locator("[data-slot='activity-card'] .activity-card-title")
      .first()
      .click({ timeout: SESSION_WAIT });
    await needs.waitFor({ state: "detached", timeout: SESSION_WAIT });
  },

  // Issue #670: the Host page folds the checks with nothing to do behind a button. Enter opens it,
  // Enter closes it, and a tool that is optional and not installed is not counted as OK.
  "health-fold": async (c) => {
    await open(c, { name: "host", host: ALFA });
    // "Show 16 checks ...": the count is the host's, so the label is matched with a number in it.
    const pattern = (key: "hostHealth.okShow" | "hostHealth.okHide") =>
      new RegExp(
        `^${c
          .t(key, { n: 99999 })
          .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace("99999", "\\d+")}$`,
      );
    const fold = c.page.getByRole("button", { name: pattern("hostHealth.okShow") });
    await fold.waitFor({ timeout: SESSION_WAIT });
    if ((await fold.getAttribute("aria-expanded")) !== "false")
      throw new Error("a dobra abriu sozinha");
    const list = c.page.getByRole("list", { name: c.t("hostHealth.okList"), exact: true });
    if ((await list.count()) !== 0) throw new Error("a lista apareceu antes de abrir");
    // The keyboard opens it: Enter on the focused button.
    await fold.focus();
    await c.page.keyboard.press("Enter");
    await list.waitFor({ timeout: WAIT });
    const hide = c.page.getByRole("button", { name: pattern("hostHealth.okHide") });
    await hide.waitFor({ timeout: WAIT });
    if ((await hide.getAttribute("aria-expanded")) !== "true")
      throw new Error("aria-expanded não abriu");
    // An optional tool that is not installed says so and does not pass for OK.
    const optional = list
      .getByRole("listitem")
      .filter({ hasText: c.t("hostHealth.optionalAbsent") });
    for (const row of await optional.all()) {
      const text = (await row.textContent()) ?? "";
      if (
        new RegExp(`\\b${c.t("hostDeps.state.ok")}\\b`).test(
          text.replace(c.t("hostHealth.optionalAbsent"), ""),
        )
      ) {
        throw new Error(`um opcional ausente aparece como OK: ${text}`);
      }
    }
    // Enter again folds it back.
    await hide.focus();
    await c.page.keyboard.press("Enter");
    await list.waitFor({ state: "detached", timeout: WAIT });
    await c.page
      .getByRole("button", { name: pattern("hostHealth.okShow") })
      .waitFor({ timeout: WAIT });
  },

  // Issue #689: with seven projects the sidebar tree draws five, folded; the filter finds one by
  // name, a pin brings it to the top, and "All projects (N)" opens the Projects page.
  "project-tree-cap": async (c) => {
    // The tree draws what the state knows of each host's projects, and the Projects page is what
    // asks for them: open it, then go back to Sessions, where the tree has to stay narrow.
    await open(c, { name: "all-projects" });
    await c.page.getByRole("button", { name: c.t("sidebar.openSessions"), exact: true }).click();
    const tree = c.page.locator("[data-slot='project-tree']");
    const heads = tree.locator(".project-tree-name");
    const names = () => heads.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    await heads.first().waitFor({ timeout: WAIT });
    const all = tree.getByRole("button", {
      name: new RegExp(
        `^${c.t("projectTree.projectsAll", { n: 99999 }).replace("99999", "\\d+").replaceAll(/[()]/g, "\\$&")}$`,
      ),
    });
    await all.waitFor({ timeout: WAIT });
    const total = Number(((await all.textContent()) ?? "").match(/\d+/)?.[0]);
    if (!(total >= 7)) throw new Error(`esperava 7 projetos ou mais, a árvore diz ${total}`);
    if ((await heads.count()) !== 5)
      throw new Error(`a árvore mostra ${await heads.count()} projetos, não 5`);
    // Past three projects the tree starts folded.
    if ((await heads.first().getAttribute("aria-expanded")) !== "false") {
      throw new Error("o primeiro projeto devia começar dobrado");
    }
    // The filter reaches a project the tree does not draw, and a pin brings it to the top.
    const filter = tree.getByRole("searchbox", {
      name: c.t("projectTree.projectFilter"),
      exact: true,
    });
    await filter.fill("design-system");
    await waitFor(async () => (await names()).join() === "design-system", "só o design-system");
    await tree
      .getByRole("button", { name: c.t("projectTree.pin", { name: "design-system" }), exact: true })
      .click();
    await filter.press("Escape");
    await waitFor(async () => (await names())[0] === "design-system", "o fixado em primeiro");
    if ((await heads.count()) !== 5)
      throw new Error("o fixado deveria ocupar um dos cinco lugares");
    // The way to all of them.
    await all.click();
    // The page's title: its subtitle names the switcher's host (#932).
    await c.page
      .getByRole("heading", { name: c.t("projectsOverview.title"), exact: true })
      .waitFor({ timeout: WAIT });
  },

  // Issue #669: Board in the sidebar lands on the host's projects as cards (a filter box past six);
  // a card opens its board, and the next Board opens that same board without asking again.
  "board-landing": async (c) => {
    await open(c, { name: "hub" });
    const board = c.page.getByRole("button", { name: c.t("sidebar.board"), exact: true });
    const cards = c.page.locator("[data-slot='board-card']");
    const newCard = c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true });
    await board.click();
    await cards.first().waitFor({ timeout: WAIT });
    if ((await cards.count()) < 7) throw new Error("o Board deveria mostrar um card por projeto");
    // Every card says what it holds: its columns (or that it has no cards yet) and its sessions.
    const facts = c.page.locator("[data-slot='board-card-columns']");
    if ((await facts.count()) !== (await cards.count()))
      throw new Error("cada card deveria dizer o que tem nas colunas");
    // More than six projects: the filter box narrows to one by name.
    const filter = c.page.getByRole("textbox", { name: c.t("boardLanding.filter"), exact: true });
    await filter.fill("design-system");
    await waitFor(async () => (await cards.count()) === 1, "só o design-system");
    await filter.fill("zzz-sem-projeto");
    await c.page.getByText(c.t("boardLanding.noMatch"), { exact: true }).waitFor({ timeout: WAIT });
    await filter.fill("design-system");
    // The card opens its board.
    await c.page
      .getByRole("button", { name: c.t("projectsUi.openBoard", { name: "design-system" }) })
      .click();
    await newCard.waitFor({ timeout: WAIT });
    // Board again: the board opened last, not the picker.
    await c.page.getByRole("button", { name: c.t("sidebar.openSessions"), exact: true }).click();
    await board.click();
    await newCard.waitFor({ timeout: WAIT });
    if ((await cards.count()) !== 0) throw new Error("o Board deveria abrir o último quadro");
  },

  // Issue #730: with no host online, Sessions is not a dead end: it says so and offers Add a host.
  // The demo's other hosts are offline, so removing the two online ones leaves none to list.
  "sessions-no-host": async (c) => {
    await open(c, { name: "hub" });
    for (const host of ["alfa", "beta"]) {
      await c.page
        .getByRole("button", { name: c.t("sidebar.hostMenu", { host }), exact: true })
        .click();
      await c.page.getByRole("menuitem", { name: c.t("sidebar.removeHost"), exact: true }).click();
      await c.page
        .getByRole("alertdialog")
        .getByRole("button", { name: c.t("sidebar.removeHost"), exact: true })
        .click();
      await c.page
        .getByRole("button", { name: c.t("sidebar.hostMenu", { host }), exact: true })
        .waitFor({ state: "detached", timeout: WAIT });
    }
    await c.page.getByText(c.t("hub.noOnlineHost"), { exact: true }).waitFor({ timeout: WAIT });
    await c.page.getByRole("button", { name: c.t("hub.addHost"), exact: true }).click();
    await c.page.getByText(c.t("sidebar.addHostCrumb"), { exact: true }).first().waitFor({
      timeout: WAIT,
    });
  },

  // Issue #731: New session -> Create session. The button is in view and clickable as the form
  // opens, in a phone-sized window and a desktop one, and it starts the session.
  "nova-sessao-alcance": async (c) => {
    const create = c.page.getByRole("button", { name: c.t("newSession.create"), exact: true });
    const prompt = c.page.getByLabel(c.t("newSession.prompt"), { exact: true });
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await open(c, { name: "new-session", host: ALFA });
      await prompt.fill("[bash] ls");
      await inReach(c, `${c.t("newSession.create")} a ${size.width}x${size.height}`, create);
    }
    // At the desktop size it also does what it says: the form leaves and the session opens.
    await create.click();
    await create.waitFor({ state: "detached", timeout: WAIT });
  },

  // Issue #644: each host has its own tabs. The row shows the shared Sessions tab and the host in
  // use; picking another host in the switcher swaps the row, and the first host's tabs are back
  // when it is picked again.
  "tabs-por-host": async (c) => {
    await open(c, { name: "hub" });
    const tabs = c.page
      .getByRole("tablist", { name: c.t("tabs.list"), exact: true })
      .getByRole("tab");
    const count = (n: number, what: string) =>
      waitFor(async () => (await tabs.count()) === n, what);
    const switcher = (host: string) =>
      c.page.getByRole("button", { name: c.t("shell.host", { host }) });
    const sidebar = c.page.locator("aside").first();
    await sidebar
      .getByRole("button", { name: c.t("sidebar.openHost", { host: "alfa" }) })
      .click({ modifiers: ["Control"] });
    await count(2, "a aba compartilhada e a do alfa");
    await switcher("alfa").waitFor({ timeout: WAIT });
    // One more tab of alfa's own (a new tab is the Overview of the host in use).
    await c.page.keyboard.press("Control+t");
    await c.page.keyboard.press("Escape");
    await count(3, "a aba compartilhada e duas do alfa");
    // Another host in the switcher: the row holds the shared tab and that host's own.
    await switcher("alfa").click();
    await c.page.getByRole("menuitemradio", { name: /beta/ }).click();
    await switcher("beta").waitFor({ timeout: WAIT });
    await count(2, "a aba compartilhada e a do beta");
    // Back to the first: its two tabs are still there.
    await switcher("beta").click();
    await c.page.getByRole("menuitemradio", { name: /alfa/ }).click();
    await switcher("alfa").waitFor({ timeout: WAIT });
    await count(3, "as duas abas do alfa voltaram");
  },

  // Issue #732: a card that has not started opens on its Run section, so Start is in view and
  // clickable without a scroll, in a phone-sized window and a desktop one. The card is left idle.
  "card-start-alcance": async (c) => {
    const title = `Card alcance ${Date.now()}`;
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
    await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
    await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
    const tile = c.page.locator(`li[aria-label="${c.t("kanban.card", { title })}"]`);
    await tile.waitFor({ timeout: WAIT });
    await tile.getByRole("button", { name: title, exact: true }).click();
    const start = c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true });
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await inReach(c, `${c.t("cardUi.start")} a ${size.width}x${size.height}`, start);
    }
  },

  // Teams (#754): the form of a new team ends in Create and start, which must be in view and
  // clickable once the goal is written, in a phone-sized window and a desktop one. Nothing is
  // created, so the other journeys' counts stay as they were (the demo's one closed team aside).
  "time-novo-alcance": async (c) => {
    const create = c.page.getByRole("button", { name: c.t("teamsUi.create"), exact: true });
    const goal = c.page.getByLabel(c.t("teamsUi.goal"), { exact: true });
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await open(c, { name: "teams" });
      await c.page
        .getByRole("button", { name: c.t("teamsUi.new"), exact: true })
        .or(c.page.getByRole("button", { name: c.t("teamsUi.emptyAction"), exact: true }))
        .first()
        .click();
      await goal.fill(`Objetivo e2e ${Date.now()}`);
      await inReach(c, `${c.t("teamsUi.create")} a ${size.width}x${size.height}`, create);
    }
  },

  // Costs (#754): Set a budget is in reach on the Costs page, and on the budgets section it opens
  // Create budget is too once a limit is typed, in a phone-sized window and a desktop one. Nothing
  // is created, so the demo's spending rules stay as they were.
  "orcamento-alcance": async (c) => {
    const setBudget = c.page.getByRole("button", { name: c.t("costsUi.setBudget"), exact: true });
    // Settings holds the section of every host, so the form is the first one: the host in use.
    const form = c.page
      .locator("form")
      .filter({ has: c.page.getByRole("button", { name: c.t("budgetsUi.create"), exact: true }) })
      .first();
    const create = form.getByRole("button", { name: c.t("budgetsUi.create"), exact: true });
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await open(c, { name: "costs" });
      await inReach(c, `${c.t("costsUi.setBudget")} a ${size.width}x${size.height}`, setBudget);
      await setBudget.click();
      await form.getByLabel(c.t("budgetsUi.limit"), { exact: true }).fill("5");
      await inReach(c, `${c.t("budgetsUi.create")} a ${size.width}x${size.height}`, create);
    }
  },

  // Simple mode (#754, #784): the palette switches to it, and its first screen keeps the
  // templates in reach at a phone's, a narrow window's and a desktop's size, without the page
  // scrolling sideways at the first two.
  "modo-simples-alcance": async (c) => {
    await open(c, { name: "hub" });
    // The palette's "Switch to simple mode" is how a person who can switch does it.
    await c.page.keyboard.press("Control+K");
    const input = c.page.getByLabel(c.t("searchUi.input"), { exact: true });
    await input.fill(c.t("palette.switchToSimple"));
    await c.page.getByRole("option", { name: c.t("palette.switchToSimple") }).click();
    const templates = c.page.getByRole("region", { name: c.t("simple.home.templates") });
    const first = templates.getByRole("button").first();
    await first.waitFor({ timeout: WAIT });
    for (const size of [
      { width: 390, height: 844 },
      { width: 640, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await c.page.setViewportSize(size);
      await inReach(c, `um modelo de tarefa a ${size.width}x${size.height}`, first);
      if (size.width < 1280) {
        const sideways = await pageScrollsSideways(c.page);
        if (sideways) throw new Error(`o modo simples rola de lado a ${size.width}: ${sideways}`);
      }
    }
  },

  // Issue #802: three layout claims the unit tests could only pin by class name are measured in
  // the browser: a reason under a disabled button sits in the flow and not over the next field, the
  // untrusted notice stays small with its link on the text line, and the status bar's items never
  // overlap or run past it at a compact, a medium and a wide window.
  "layout-medido": async (c) => {
    // 1. The Run row of a card that has not started: its reasons are lines of the row's own box.
    const title = `Card medido ${Date.now()}`;
    await c.page.setViewportSize({ width: 1280, height: 800 });
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
    await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
    await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
    const tile = c.page.locator(`li[aria-label="${c.t("kanban.card", { title })}"]`);
    await tile.waitFor({ timeout: WAIT });
    await tile.getByRole("button", { name: title, exact: true }).click();
    const start = c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true });
    await start.waitFor({ timeout: WAIT });
    const reasons = await start.evaluate((button) => {
      const wrap = button.closest(".field-row-wrap");
      const row = wrap?.querySelector(".field-row");
      if (!wrap || !row) return "the Run row has no wrapper";
      const edge = (el: Element) => el.getBoundingClientRect();
      const helps = [...wrap.querySelectorAll(".field-help")];
      if (helps.length < 2) return `expected two reasons under the row, found ${helps.length}`;
      const next = wrap.nextElementSibling;
      let above = edge(row).bottom;
      for (const help of helps) {
        const box = edge(help);
        if (box.top < above - 1) return `a reason starts at ${box.top}, above ${above}`;
        above = box.bottom;
      }
      if (edge(wrap).bottom < above - 1) return "the reasons hang out of the row's box";
      if (next && edge(next).top < above - 1) return "the reasons run over the next block";
      return null;
    });
    if (reasons) throw new Error(`a razão sob o botão desabilitado: ${reasons}`);

    // 2. The untrusted notice of a session: small, and its link is on the text line.
    await c.page.setViewportSize({ width: 1280, height: 800 });
    await open(c, { name: "session", host: ALFA, id: c.ids.waitingSession });
    const review = c.page.getByRole("button", {
      name: c.t("projectPage.trust.review"),
      exact: true,
    });
    await review.waitFor({ timeout: WAIT });
    const notice = await review.evaluate((link) => {
      const box = link.closest("[role='status']")?.getBoundingClientRect();
      const own = link.getBoundingClientRect();
      return box ? { height: box.height, link: own.height } : null;
    });
    if (!notice) throw new Error("o aviso de pasta sem confiança não está em um role=status");
    if (notice.link >= 30) throw new Error(`o link do aviso tem ${notice.link}px: cresceu`);
    if (notice.height > 72) throw new Error(`o aviso tem ${notice.height}px de altura`);

    // 3. The status bar at three widths: nothing overlaps and nothing runs past the bar.
    for (const width of [500, 800, 1280]) {
      await c.page.setViewportSize({ width, height: 800 });
      await open(c, { name: "hub" });
      const bar = c.page.locator("[data-slot='status-bar']");
      await bar.waitFor({ timeout: WAIT });
      const problem = await bar.evaluate((el) => {
        const whole = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 1) return "the bar scrolls sideways";
        const items = [...el.querySelectorAll("button, a, [role='status']")]
          .map((item) => item.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0);
        for (const box of items) {
          if (box.right > whole.right + 1 || box.left < whole.left - 1)
            return "an item is past the bar";
        }
        for (let a = 0; a < items.length; a++) {
          for (let b = a + 1; b < items.length; b++) {
            const x = items[a] as DOMRect;
            const y = items[b] as DOMRect;
            const across = Math.min(x.right, y.right) - Math.max(x.left, y.left);
            const down = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
            if (across > 2 && down > 2) return `two items overlap (${a} and ${b})`;
          }
        }
        return null;
      });
      if (problem) throw new Error(`a barra de status a ${width}px: ${problem}`);
    }
  },

  // Issue #1131: a request is answered from the bell, in its row, at a phone's width too. The
  // session's own request is put in the bell by hand (the web demo sends no notification), then
  // answered there, and its row is gone from the bell.
  "bell-approve": async (c) => {
    const session = `Sino e2e ${Date.now()}`;
    await createSession(c, "[bash] ls", session);
    await open(c, { name: "needs-you" });
    await c.page
      .locator("main ul li button", { hasText: session })
      .first()
      .click({ timeout: SESSION_WAIT });
    const card = c.page.locator("fieldset[data-request-id]").first();
    await card.waitFor({ timeout: WAIT });
    const requestId = await card.getAttribute("data-request-id");
    const link = `flightdeck://request?${new URLSearchParams({ host: ALFA, request: requestId ?? "" })}`;
    const seed = JSON.stringify([
      {
        id: "bell-approve",
        at: new Date().toISOString(),
        title: "Precisa de você",
        body: "",
        link,
        subject: session,
        host: "alfa",
        ask: "Quer executar: ls",
        read: false,
      },
    ]);
    await c.page.evaluate((value) => localStorage.setItem("flightdeck.inbox", value), seed);
    await c.page.setViewportSize({ width: 390, height: 800 });
    await open(c, { name: "hub" });
    await c.page.getByRole("button", { name: /^(Notifications|Notificações)/ }).click();
    const dialog = c.page.getByRole("dialog");
    await dialog.waitFor({ timeout: WAIT });
    const group = dialog.getByRole("group", { name: new RegExp(session) });
    await group.waitFor({ timeout: SESSION_WAIT });
    // The row fits the panel: no sideways scroll and nothing past its right edge.
    const fits = await dialog.evaluate((box) => {
      const edge = box.getBoundingClientRect().right;
      const past = [...box.querySelectorAll<HTMLElement>(".inbox-request > *")].filter(
        (el) => el.getBoundingClientRect().right > edge + 1,
      );
      return box.scrollWidth <= box.clientWidth + 1 && past.length === 0;
    });
    if (!fits) throw new Error("a linha do pedido passa do painel do sino a 390 px");
    await group.getByRole("button", { name: c.t("approval.approve"), exact: true }).click();
    await waitFor(async () => (await group.count()) === 0, "o pedido saiu do sino");
  },

  // Issues #1030 and #1031: at the usual window the board fills its width with all five columns
  // (none cut at the right edge, no head running past its column), and the Return on cost card is
  // one short row, so the columns start right under it.
  "board-fit": async (c) => {
    await c.page.setViewportSize({ width: 1280, height: 800 });
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    const grid = c.page.locator("[data-slot='board-columns']");
    await grid.waitFor({ timeout: WAIT });
    const measure = () =>
      grid.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const lanes = [...el.querySelectorAll("section[data-column]")].map((lane) =>
          lane.getBoundingClientRect(),
        );
        const last = lanes[lanes.length - 1];
        return {
          lanes: lanes.length,
          scroll: el.scrollWidth,
          client: el.clientWidth,
          inside: lanes.every((lane) => lane.right <= window.innerWidth),
          // The columns share the width: the last one reaches (almost) the row's right edge.
          gap: last === undefined ? Number.NaN : box.right - last.right,
        };
      });
    const fits = async () => {
      const m = await measure();
      return m.lanes === 5 && m.scroll <= m.client + 1 && m.inside && m.gap <= 24;
    };
    try {
      await waitFor(fits, "as cinco colunas cabem na largura do quadro, a 1280");
    } catch (error) {
      throw new Error(`${(error as Error).message}: ${JSON.stringify(await measure())}`);
    }
    // A head is one line: its items share a top, and none runs past the lane's right edge.
    const heads = await grid.evaluate((el) =>
      [...el.querySelectorAll("section[data-column]")].flatMap((lane) => {
        const edge = lane.getBoundingClientRect().right;
        const name = lane.getAttribute("data-column") ?? "";
        const items = [...lane.querySelectorAll(".column-head > *")].map((item) =>
          item.getBoundingClientRect(),
        );
        const past = items.some((box) => box.right > edge + 1);
        const wrapped = items.some((box) => Math.abs(box.top - (items[0]?.top ?? 0)) > 6);
        return past || wrapped ? [name] : [];
      }),
    );
    if (heads.length > 0) {
      throw new Error(`o cabeçalho passa da coluna: ${[...new Set(heads)].join(", ")}`);
    }
    // The Return on cost card, when the demo has one: one short row, and the columns right under it.
    const roi = c.page.getByRole("region", { name: c.t("roiUi.title"), exact: true });
    if ((await roi.count()) > 0) {
      // Folded and loaded: the details button says it is closed (the loading box has none).
      await c.page
        .getByRole("button", { name: c.t("roiUi.details"), exact: true })
        .and(c.page.locator("[aria-expanded='false']"))
        .waitFor({ timeout: WAIT });
      const gap = await roi.evaluate((card) => {
        const own = card.getBoundingClientRect();
        const columns = document.querySelector("[data-slot='board-columns']");
        return {
          height: own.height,
          below: (columns?.getBoundingClientRect().top ?? 0) - own.bottom,
        };
      });
      if (gap.height > 64) throw new Error(`o card de retorno tem ${gap.height}px dobrado`);
      if (gap.below > 32) throw new Error(`as colunas começam ${gap.below}px abaixo do card`);
    }
  },

  // Issue #790: a session moves from alfa to beta. The preview is switched on, the demo's movable
  // transcript is resumed on alfa and moved to beta's clone, the dialog shows only counts (none of
  // the conversation's words), and "Open it there" lands on the session on beta.
  "teleport-mover": async (c) => {
    const claudeSessionId = DEMO_TELEPORT_SESSIONS[c.lang];
    await open(c, { name: "settings", section: "window" });
    const preview = c.page.getByLabel(c.t("teleportUi.preview"), { exact: true });
    await preview.waitFor({ timeout: WAIT });
    if (!(await preview.isChecked())) await preview.check();
    // Resume the transcript on alfa through the reader.
    await open(c, { name: "external", host: ALFA, claudeSessionId });
    await c.page.getByRole("button", { name: c.t("reader.continue"), exact: true }).click();
    const anyway = c.page.getByRole("button", { name: c.t("reader.continueAnyway"), exact: true });
    await anyway.click({ timeout: 3000 }).catch(() => undefined);
    // Continuing lands on the hub with the new session open. The row is not titled by the
    // transcript: a host with standard names calls it "app · geral · N", so it is found by what
    // marks it, the open session (aria-current), never by its title.
    await c.page.getByRole("button", { name: c.t("hub.expandAll"), exact: true }).click();
    const row = c.page.getByRole("main").locator("li[aria-current='true']");
    const actions = row.getByRole("button", {
      name: new RegExp(
        c.t("hub.actions", { title: "§" }).replace("§", ".*").replaceAll(/[()]/g, "\\$&"),
      ),
    });
    const move = c.page.getByRole("menuitem", { name: c.t("teleportUi.menu"), exact: true });
    const menus: string[][] = [];
    await waitFor(
      async () => {
        // The row may not be listed yet: a missed click is another turn of the wait, not a failure.
        const clicked = await actions
          .first()
          .click({ timeout: 2000 })
          .then(
            () => true,
            () => false,
          );
        if (!clicked) return false;
        if (await move.isVisible()) return true;
        menus.push(await c.page.getByRole("menuitem").allTextContents());
        await c.page.keyboard.press("Escape");
        return false;
      },
      "o menu da sessão aberta oferecer mover para outro host",
      SESSION_WAIT,
    ).catch(async (error: Error) => {
      // What the page showed, so a red run says why without a second one.
      const rows = await c.page
        .getByRole("main")
        .locator("li[aria-label]")
        .evaluateAll((els) => els.map((e) => `${e.ariaLabel}${e.ariaCurrent ? " (aberta)" : ""}`));
      throw new Error(
        `${error.message} (linhas: ${JSON.stringify(rows)}; itens do menu: ${JSON.stringify(menus.at(-1))})`,
      );
    });
    await move.click();
    const dialog = c.page.getByRole("dialog", { name: c.t("teleportUi.title") });
    await dialog.getByLabel(c.t("teleportUi.host"), { exact: true }).selectOption({ label: BETA });
    await dialog.getByLabel(c.t("teleportUi.repo"), { exact: true }).fill(c.ids.teleportRepo);
    await dialog.getByRole("button", { name: c.t("teleportUi.next"), exact: true }).click();
    const go = dialog.getByRole("button", { name: c.t("teleportUi.move"), exact: true });
    await go.waitFor({ timeout: SESSION_WAIT });
    // Counts only: what changed and how big, never a word of the conversation or the code.
    const text = (await dialog.textContent()) ?? "";
    // How many files changed depends on the demo's repository, which other journeys edit: a count.
    const counted = new RegExp(
      c
        .t("teleportUi.changed", { n: "§" })
        .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace("§", "[1-9]\\d*"),
    );
    if (!counted.test(text)) {
      throw new Error(`o resumo devia contar os arquivos alterados: ${text.slice(0, 300)}`);
    }
    for (const leak of ["Ajuste", "revise", "export const"]) {
      if (text.includes(leak))
        throw new Error(`o resumo mostrou texto da conversa ou do código: ${leak}`);
    }
    await go.click();
    await dialog
      .getByRole("button", { name: c.t("teleportUi.open"), exact: true })
      .click({ timeout: SESSION_WAIT });
    // The dialog leaves with the click (#842), and the session is on beta: the host in use is beta.
    await dialog.waitFor({ state: "hidden", timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("shell.host", { host: BETA }) })
      .waitFor({ timeout: WAIT });
  },

  // A session page's views (#107, #846): the tablist and Alt+1..7 switch them, the Terminal view
  // opens a shell in the session's folder and keeps it while another view shows, and closing the
  // terminal ends the shell (opening the view again starts a new one). The Terminal tab is in
  // reach in a phone-sized window and a desktop one.
  "sessao-vistas": async (c) => {
    const route: Route = { name: "session", host: ALFA, id: c.ids.idleSession };
    const list = c.page.getByRole("tablist", { name: c.t("sessionViews.label"), exact: true });
    const tabs = list.getByRole("tab");
    const terminalTab = list.getByRole("tab", { name: c.t("sessionViews.terminal"), exact: true });
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await open(c, route);
      await terminalTab.waitFor({ timeout: WAIT });
      if (size.width >= 800) {
        // The strip fits: the tab is in the window with nothing scrolled.
        await inReach(c, `a aba Terminal a ${size.width}x${size.height}`, terminalTab);
      } else {
        // The strip scrolls sideways by design (its tabs keep their width): the tab comes into
        // view with the strip scrolled, and the page itself never scrolls sideways.
        await terminalTab.scrollIntoViewIfNeeded();
        await terminalTab.click({ trial: true, timeout: WAIT });
        const sideways = await c.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (sideways > 0)
          throw new Error(`a página rola ${sideways}px para o lado a ${size.width}px`);
      }
    }
    // Alt+1..7 pick the views in the order of the tabs; the tab picked says so.
    const count = await tabs.count();
    if (count < 2) throw new Error(`a página da sessão devia ter várias vistas, tem ${count}`);
    const selected = async () => {
      const marks = await tabs.evaluateAll((els) => els.map((e) => e.ariaSelected === "true"));
      return marks.indexOf(true);
    };
    await tabs.first().click();
    for (let i = 1; i < Math.min(count, 7); i++) {
      await c.page.keyboard.press(`Alt+${i + 1}`);
      await waitFor(async () => (await selected()) === i, `Alt+${i + 1} escolher a vista ${i + 1}`);
    }
    await c.page.keyboard.press("Alt+1");
    await waitFor(async () => (await selected()) === 0, "Alt+1 voltar à conversa");
    // The Terminal view: a shell in the session's folder, kept while the conversation shows.
    const marker = `fd-${c.lang}-${Date.now()}`;
    const rows = c.page.locator(".xterm-rows");
    const screen = async () => ((await rows.first().textContent()) ?? "").trim();
    await terminalTab.click();
    await c.page
      .getByText(c.t("terminalUi.state.live"), { exact: true })
      .waitFor({ timeout: WAIT * 2 });
    await waitFor(async () => (await screen()) !== "", "o prompt do shell");
    await c.page.locator(".xterm").first().click();
    await c.page.keyboard.type("PS1='$ '\n");
    await c.page.keyboard.type(`echo ${marker}\n`);
    const echoes = async () => (await screen()).split(marker).length - 1;
    await waitFor(async () => (await echoes()) >= 2, "o eco do terminal", WAIT * 2);
    // Ctrl+` goes back to the conversation and to the same shell, which kept what was typed.
    await c.page.keyboard.press("Control+Backquote");
    await waitFor(async () => (await selected()) === 0, "Ctrl+` voltar à conversa");
    await c.page.keyboard.press("Control+Backquote");
    await waitFor(async () => (await echoes()) >= 2, "o mesmo shell, com o que foi digitado");
    // Closing the terminal ends the shell and returns to the conversation.
    const end = async () => {
      await c.page.getByRole("button", { name: c.t("terminalUi.close"), exact: true }).click();
      await c.page.getByRole("button", { name: c.t("terminalUi.end"), exact: true }).click();
      await waitFor(async () => (await selected()) === 0, "a conversa depois de encerrar");
    };
    await end();
    // A new shell, not the one that ended: what was typed is not there.
    await terminalTab.click();
    await c.page
      .getByText(c.t("terminalUi.state.live"), { exact: true })
      .waitFor({ timeout: WAIT * 2 });
    await waitFor(async () => (await screen()) !== "", "o prompt do novo shell");
    if ((await echoes()) !== 0) throw new Error("o terminal encerrado voltou com o shell antigo");
    // The demo keeps its state: leave no shell running.
    await end();
  },

  // The board's Files panel (#117, #846): a worktree picked in the sidebar tree opens its files
  // beside the columns; a name search finds a file and marks a credential as hidden instead of
  // opening it; a content search finds a key-shaped line without its key (#827, #829) and finds
  // nothing in a credential file; a match opens its file. Then the panel's search box is in reach
  // in a phone-sized window and a desktop one.
  "board-arquivos": async (c) => {
    await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
    const tree = c.page.locator("[data-slot='project-tree']");
    const head = tree.locator("[data-project='flightdeck-web']");
    await head.waitFor({ timeout: WAIT });
    if ((await head.getAttribute("aria-expanded")) === "false") await head.click();
    await tree.getByRole("button", { name: /fd\/revisar-o-fluxo-de-login/ }).click();
    const panel = c.page.locator("[data-slot='board-files']");
    await panel.getByText("app.ts").first().waitFor({ timeout: WAIT });
    const results = panel.getByRole("list", { name: c.t("files.results"), exact: true });
    // By name: the file is found; a credential is listed as hidden and cannot be opened.
    const names = panel.getByRole("searchbox", { name: c.t("files.searchNames"), exact: true });
    await names.fill("config");
    await results.getByRole("button", { name: "config.example.ts", exact: true }).waitFor({
      timeout: WAIT,
    });
    await names.fill(".env");
    await results
      .getByText(c.t("files.hidden"), { exact: true })
      .first()
      .waitFor({ timeout: WAIT });
    if ((await results.getByRole("button", { name: ".env", exact: true }).count()) > 0) {
      throw new Error("um arquivo de credencial devia aparecer como oculto, sem botão para abrir");
    }
    // By content: the key-shaped line is found, and nothing of the key shows.
    await panel.getByRole("button", { name: c.t("files.byContent"), exact: true }).click();
    const content = panel.getByRole("searchbox", { name: c.t("files.searchContent"), exact: true });
    await content.fill("chave de exemplo");
    await results.getByRole("button", { name: /^config\.example\.ts:\d+$/ }).waitFor({
      timeout: WAIT,
    });
    const shown = (await results.textContent()) ?? "";
    for (const leak of [DEMO_FAKE_KEY, "demodemo"]) {
      if (shown.includes(leak)) throw new Error(`a busca por conteúdo mostrou a chave: ${leak}`);
    }
    if (!shown.includes("[redacted]")) {
      throw new Error(`a linha com a chave devia sair mascarada: ${shown.slice(0, 200)}`);
    }
    // A credential file's content is never searched.
    await content.fill("DEMO_MODE");
    await panel.getByText(c.t("files.nothingFound"), { exact: true }).waitFor({ timeout: WAIT });
    // A match opens its file.
    await panel.getByRole("button", { name: c.t("files.byName"), exact: true }).click();
    await panel
      .getByRole("searchbox", { name: c.t("files.searchNames"), exact: true })
      .fill("app.ts");
    await results.getByRole("button", { name: "app.ts", exact: true }).click();
    const viewer = c.page.getByRole("region", { name: c.t("files.viewer", { path: "app.ts" }) });
    await viewer.locator(".cm-line").first().waitFor({ timeout: WAIT });
    await viewer.getByRole("button", { name: c.t("files.close"), exact: true }).click();
    // The panel's search box is in reach in a phone-sized window and a desktop one.
    const toggle = c.page.getByRole("button", { name: c.t("board.files"), exact: true });
    const search = panel.getByRole("searchbox").first();
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      if (!(await search.isVisible())) {
        if ((await toggle.count()) === 0)
          throw new Error("o botão Arquivos sumiu ao redimensionar");
        await toggle.click();
      }
      await inReach(c, `a busca de arquivos a ${size.width}x${size.height}`, search);
    }
  },

  // Home's leaderboard (#124, #846): where the tokens of the last 7 days went, by project, model and
  // persona. Every row says its share, its tokens and its trend in words; a project's row opens Costs
  // on that project; the panel does not run past the window at a phone's size or a desktop's. The
  // notice for a host that does not answer is not here: the demo has no priced host that fails.
  "ranking-home": async (c) => {
    const loaded = c.page.getByRole("tablist", { name: c.t("home.leadersBy"), exact: true });
    const rows = c.page.locator(".leader-row");
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await open(c, { name: "overview" });
      await loaded.waitFor({ timeout: SESSION_WAIT });
      await rows.first().waitFor({ timeout: WAIT });
      // No row runs past the window sideways.
      const wide = await c.page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const over = [...document.querySelectorAll(".leader-panel *")].filter(
          (el) => el.getBoundingClientRect().right > limit + 1,
        );
        return over.length;
      });
      if (wide > 0) throw new Error(`${wide} itens do ranking passam da janela a ${size.width}px`);
    }
    // Each grouping lists rows with a share, its tokens and its trend in words.
    for (const tab of ["home.byProject", "home.byModel", "home.byPersona"] as const) {
      await loaded.getByRole("tab", { name: c.t(tab), exact: true }).click();
      const panel = c.page.getByRole("tabpanel").filter({ has: c.page.locator(".leader-row") });
      await panel.first().waitFor({ timeout: WAIT });
      const parts = await panel
        .first()
        .locator(".leader-row")
        .first()
        .evaluate((row) =>
          [".leader-share", ".leader-tokens", ".leader-trend"].map(
            (sel) => row.querySelector(sel)?.textContent?.trim() ?? "",
          ),
        );
      if (parts.some((text) => text === "")) {
        throw new Error(`uma linha de ${c.t(tab)} sem parte do texto: ${JSON.stringify(parts)}`);
      }
    }
    // A project's row opens Costs on that project.
    await loaded.getByRole("tab", { name: c.t("home.byProject"), exact: true }).click();
    const open_ = c.page.getByRole("button", {
      name: new RegExp(`^${c.t("home.openProject", { name: "§" }).replace("§", ".+")}$`),
    });
    await open_.first().waitFor({ timeout: WAIT });
    const label = (await open_.first().textContent())?.trim() ?? "";
    await open_.first().click();
    // One project, one label (#881): Costs' Data from menu names it as Home does (#126 slice 4).
    await c.page
      .getByRole("button", { name: c.t("scope.menu", { scope: label }), exact: true })
      .waitFor({ timeout: WAIT });
  },

  // Issue #932: with a host chosen in the switcher, opening one of its projects keeps that host; with
  // the tabs of all hosts, opening another host's project says the switch, and its toast's button
  // goes back. (The demo's projects are alfa's, so beta is the host the switch leaves.)
  "projetos-host": async (c) => {
    const switcher = (host: string) =>
      c.page.getByRole("button", { name: c.t("shell.host", { host }), exact: true });
    const card = (name: string, host: string) =>
      c.page.getByRole("button", {
        name: c.t("projectsOverview.open", { name, host }),
        exact: true,
      });
    await open(c, { name: "host", host: ALFA });
    await switcher("alfa").waitFor({ timeout: WAIT });
    await open(c, { name: "all-projects" });
    await card("flightdeck-web", "alfa").click();
    await switcher("alfa").waitFor({ timeout: WAIT });
    const said = c.page.getByText(c.t("toast.switchedHost", { host: "alfa" }), { exact: true });
    if ((await said.count()) > 0) throw new Error("abrir um projeto do próprio host avisou troca");
    // Beta in the switcher, with the tabs of all hosts: alfa's projects are listed there too.
    await switcher("alfa").click();
    await c.page.getByRole("menuitemradio", { name: new RegExp(`^${BETA}`) }).click();
    await switcher(BETA).click();
    await c.page
      .getByRole("menuitemcheckbox", { name: c.t("shell.allHostsTabs"), exact: true })
      .click();
    await c.page.keyboard.press("Escape");
    // The sidebar's Projects, not a reload: the switcher's pick is this window's.
    await c.page
      .locator("aside")
      .first()
      .getByRole("button", { name: new RegExp(`^${c.t("sidebar.projects")}`) })
      .first()
      .click();
    await card("flightdeck-web", "alfa").click();
    await said.waitFor({ timeout: WAIT });
    await switcher("alfa").waitFor({ timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("toast.backTo", { host: BETA }), exact: true })
      .click();
    await switcher(BETA).waitFor({ timeout: WAIT });
  },

  // Issue #931: the Projects page adds a project. The route names alfa, so one host is in scope and
  // the button opens the add form for it at once (the pick between hosts is a component test).
  "projeto-novo": async (c) => {
    await open(c, { name: "all-projects", host: ALFA });
    await c.page
      .getByRole("button", { name: c.t("projectsOverview.newProject"), exact: true })
      .click();
    const dialog = c.page.getByRole("dialog", { name: c.t("addProject.title"), exact: true });
    await dialog.getByLabel(c.t("addProject.folder"), { exact: true }).fill(c.ids.freshRepo);
    await dialog.getByRole("button", { name: c.t("addProject.add"), exact: true }).click();
    // The project is added, and the Projects page lists it.
    await open(c, { name: "all-projects", host: ALFA });
    await c.page.locator('li[data-project="fresh-app"]').waitFor({ timeout: WAIT });
  },

  // Home's data scope (#126, #846): the Data from menu switches Home between all hosts and one
  // host, the choice is kept when the page is opened again, a host that is offline says so and
  // offers all hosts, and the menu is in reach in a phone-sized window and a desktop one.
  // Issue #934: a closed team is deleted from its card's menu after a confirmation, the card goes,
  // and the sessions of its members are still there. The demo keeps one closed team for it.
  "time-apagar": async (c) => {
    await open(c, { name: "teams", host: ALFA });
    const row = c.page.getByRole("listitem", {
      name: c.t("teamsUi.row", { name: DEMO_CLOSED_TEAM }),
    });
    await row.waitFor({ timeout: WAIT });
    await row
      .getByRole("button", { name: c.t("teamsUi.menu", { name: DEMO_CLOSED_TEAM }) })
      .click();
    await c.page.getByRole("menuitem", { name: c.t("teamsUi.delete"), exact: true }).click();
    await c.page
      .getByRole("alertdialog")
      .getByRole("button", { name: c.t("teamsUi.delete"), exact: true })
      .click();
    await row.waitFor({ state: "detached", timeout: WAIT });
    // The coordinator's session is still there, and open.
    await open(c, { name: "session", host: ALFA, id: c.ids.idleSession });
    await c.page.getByLabel(c.t("session.message"), { exact: true }).waitFor({ timeout: WAIT });
  },

  "escopo-dados": async (c) => {
    const menuOf = (scope: string) =>
      c.page.getByRole("button", { name: c.t("scope.menu", { scope }), exact: true });
    const all = c.t("scope.all");
    const pick = async (from: string, host: string) => {
      await menuOf(from).click();
      await c.page.getByRole("menuitemradio", { name: host, exact: true }).click();
    };
    for (const size of REACH_VIEWPORTS) {
      await c.page.setViewportSize(size);
      await open(c, { name: "overview" });
      await inReach(c, `o menu Dados de a ${size.width}x${size.height}`, menuOf(all));
    }
    // One host: the trigger and the subtitle say whose numbers they are.
    const subtitle = (host: string) =>
      c.page.getByText(c.t("home.rangeHost", { host }), { exact: true });
    await pick(all, "alfa");
    await menuOf("alfa").waitFor({ timeout: WAIT });
    await subtitle("alfa").waitFor({ timeout: WAIT });
    // Kept: the page opened again is still on alfa.
    await open(c, { name: "overview" });
    await menuOf("alfa").waitFor({ timeout: WAIT });
    await subtitle("alfa").waitFor({ timeout: WAIT });
    // A host that is offline: Home says so and offers all hosts, which brings them back.
    await pick("alfa", "notebook");
    await menuOf("notebook").waitFor({ timeout: WAIT });
    const showAll = c.page.getByRole("button", { name: c.t("scope.showAll"), exact: true });
    await showAll.waitFor({ timeout: SESSION_WAIT });
    await showAll.click();
    await menuOf(all).waitFor({ timeout: WAIT });
    await c.page.getByText(c.t("home.range"), { exact: true }).waitFor({ timeout: WAIT });
  },
};

/** The page never scrolls sideways: when it does, the guards name the widest element. */
async function pageScrollsSideways(page: Page): Promise<string | null> {
  const found: Finding[] = await page.evaluate(layoutFindings, {});
  const sideways = found.find((finding) => finding.rule === "sideways");
  return sideways ? `${sideways.path}: ${sideways.detail}` : null;
}

/**
 * The crumbs end inside their own box, so the tabs after it start clear of them, and what does not
 * fit is cut with an ellipsis (issue #133). The bell moved to the top bar's right side (#282).
 */
async function crumbsProblem(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>(".header-crumbs");
    const nav = slot?.querySelector<HTMLElement>("nav");
    // Under 640 px the page's own header carries the title: the bar draws no path (#641).
    if (window.innerWidth < 640) return nav ? "a path is drawn under 640 px" : null;
    if (!slot || !nav) return "no breadcrumb";
    const limit = slot.getBoundingClientRect().right + 1;
    // Where the person is must stay readable: the current step never shrinks to nothing.
    const current = nav.querySelector<HTMLElement>("[aria-current='page']");
    if (current && current.getBoundingClientRect().width < 48) {
      return `the current crumb (${current.textContent}) is ${Math.round(current.getBoundingClientRect().width)}px wide`;
    }
    for (const el of nav.querySelectorAll<HTMLElement>("li > *")) {
      const box = el.getBoundingClientRect();
      if (box.right > limit)
        return `a crumb (${el.textContent}) ends at ${Math.round(box.right)}, past its box at ${Math.round(limit)}`;
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

/**
 * Since #488 a tab is as wide as its title, as in VS Code: never under the minimum, never past 13rem.
 * The shared tabs are pinned and show only their icon (#644), so they are not counted.
 */
async function tabWidthsProblem(page: Page, minimum: number): Promise<string | null> {
  // Under 640 px the row is one button, the current tab's, that opens the list (#641).
  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 640) {
    const button = page.getByRole("button", { name: /^(Todas as abas|All tabs) \(/ });
    return (await button.count()) === 1 ? null : "no compact tab button";
  }
  const widths = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".tab-item:not([data-pinned])")].map((tab) =>
      Math.round(tab.getBoundingClientRect().width),
    ),
  );
  if (widths.length === 0) return "no tabs";
  if (Math.max(...widths) > 208 + 1) return `a tab is ${Math.max(...widths)}px, past 13rem`;
  if (Math.min(...widths) < minimum) return `a tab is ${Math.min(...widths)}px, under ${minimum}px`;
  return null;
}

/**
 * The list of all tabs behind the chevron (#576): never wider than 24rem nor the window less 2rem,
 * no row on two lines, nothing scrolling sideways, and Esc closes it.
 */
async function tabListProblem(page: Page): Promise<string | null> {
  const name = /^(Todas as abas|All tabs)$/;
  // Under 640 px the button is the current tab's, named "All tabs (N), current: ...".
  await page.getByRole("button", { name: /^(Todas as abas|All tabs)( \(|$)/ }).click();
  await page.getByRole("listbox", { name }).waitFor({ timeout: 5000 });
  const problem = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-slot='tab-overflow']");
    if (!box) return "the list did not open";
    const width = box.getBoundingClientRect().width;
    // Under 640 px the list takes the window less 1rem; wider, 24rem at most and the window less 2rem.
    const most =
      window.innerWidth < 640 ? window.innerWidth - 16 : Math.min(384, window.innerWidth - 32);
    if (width > most + 1) return `the list is ${Math.round(width)}px, past ${most}px`;
    const list = box.querySelector<HTMLElement>("[role='listbox']");
    if (list && list.scrollWidth > list.clientWidth + 1) return "the list scrolls sideways";
    for (const title of box.querySelectorAll<HTMLElement>("[data-slot='tab-title']")) {
      if (title.getBoundingClientRect().height > 24) return `"${title.title}" takes two lines`;
    }
    return null;
  });
  await page.keyboard.press("Escape");
  const closed = await page
    .getByRole("listbox", { name })
    .waitFor({ state: "detached", timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  return problem ?? (closed ? null : "Esc did not close the list");
}

/**
 * The active tab stands out (#488): only it has the accent line on top, at 3:1 or more against
 * the tab and the bar in both themes, and it reaches the bar's lower edge so it joins the screen
 * below. Hovering another tab looks different from the active one.
 */
async function activeTabProblem(page: Page): Promise<string | null> {
  const problems = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return ["no canvas to read colours"];
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0] ?? 0) + 0.7152 * f(c[1] ?? 0) + 0.0722 * f(c[2] ?? 0);
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };
    const bar = document.querySelector<HTMLElement>(".tab-bar");
    if (!bar) return ["no tab bar"];
    const found: string[] = [];
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    for (const dark of [false, true]) {
      root.classList.toggle("dark", dark);
      const theme = dark ? "dark" : "light";
      const items = [...bar.querySelectorAll<HTMLElement>(".tab-item")];
      const active = items.find((it) => it.querySelector('[role="tab"][aria-selected="true"]'));
      const lined = items.filter((it) => {
        const content = getComputedStyle(it, "::before").content;
        return content !== "none" && content !== "normal" && content !== "";
      });
      if (!active || lined.length !== 1 || lined[0] !== active) {
        found.push(`${theme}: ${lined.length} tabs have the accent line, not only the active one`);
        continue;
      }
      const line = rgb(getComputedStyle(active, "::before").backgroundColor);
      for (const [name, el] of [
        ["tab", active],
        ["bar", bar],
      ] as const) {
        const r = ratio(line, rgb(getComputedStyle(el).backgroundColor));
        if (r < 3) found.push(`${theme}: the accent line is ${r.toFixed(2)}:1 against the ${name}`);
      }
    }
    root.classList.toggle("dark", wasDark);
    const active = bar.querySelector<HTMLElement>(
      '.tab-item:has([role="tab"][aria-selected="true"])',
    );
    const gap = active
      ? bar.getBoundingClientRect().bottom - active.getBoundingClientRect().bottom
      : 0;
    if (gap > 0.5)
      found.push(`the active tab ends ${gap}px above the bar's edge, whose line runs under it`);
    return found;
  });
  const other = page.locator('.tab-item:not(:has([role="tab"][aria-selected="true"]))').first();
  if (await other.count()) {
    await other.hover();
    const [hovered, active] = await page.evaluate(() => [
      getComputedStyle(document.querySelector(".tab-item:hover") ?? document.body).backgroundColor,
      getComputedStyle(
        document.querySelector('.tab-item:has([role="tab"][aria-selected="true"])') ??
          document.body,
      ).backgroundColor,
    ]);
    if (hovered === active) problems.push("a hovered tab looks like the active one");
    await page.mouse.move(0, 0);
  }
  return problems.length ? problems.join("; ") : null;
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
  await c.page
    .getByRole("img", { name: /^(alfa|beta): / })
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  await c.page.evaluate(waitForStable, { frames: 3, maxMs: 5000, boxes: GAP_BOXES });
}

/**
 * The bell's panel (issue #137): every button of its header and every Dismiss is inside the panel's
 * box, and the panel does not scroll sideways. A row about a card that is gone is in the list.
 */
async function bellPanelProblems(c: Context): Promise<string[]> {
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const entry = (id: string, second: number, extra: Record<string, unknown>) => ({
    id,
    at: new Date(dayStart + second * 1000).toISOString(),
    title: "Precisa de você",
    body: "",
    read: false,
    ...extra,
  });
  const seed = JSON.stringify([
    entry("1", 300, {
      subject: "api · refatorar",
      host: "alfa",
      ask: "Pergunta: qual banco usar?",
    }),
    entry("2", 200, {
      subject: "Card B com um nome bem comprido para o painel",
      host: "alfa",
      ask: "Quer alterar main.ts",
      route: { name: "card", host: "demo-alfa", projectId: "gone", cardId: "gone" },
    }),
  ]);
  await c.page.evaluate((value) => localStorage.setItem("flightdeck.inbox", value), seed);
  await open(c, { name: "hub" });
  await c.page.getByRole("button", { name: /^(Notifications|Notificações)/ }).click();
  const dialog = c.page.getByRole("dialog");
  await dialog.waitFor({ timeout: WAIT });
  const found = await dialog.evaluate((box) => {
    const edge = box.getBoundingClientRect();
    const out: string[] = [];
    if (box.scrollWidth > box.clientWidth + 1) out.push("o painel rola para o lado");
    const dismiss = [...box.querySelectorAll<HTMLElement>("button")].filter((b) =>
      /^(Dismiss|Descartar)$/.test(b.textContent?.trim() ?? ""),
    );
    if (dismiss.length === 0) out.push("a linha de um alvo que não existe mais não tem Descartar");
    const headerButtons = [...(box.querySelector("div")?.querySelectorAll("button") ?? [])];
    for (const button of [...headerButtons, ...dismiss]) {
      const at = button.getBoundingClientRect();
      if (at.width > 0 && (at.left < edge.left - 1 || at.right > edge.right + 1)) {
        out.push(`o botão "${button.textContent?.trim()}" sai do painel`);
      }
    }
    return out;
  });
  await c.page.evaluate(() => localStorage.removeItem("flightdeck.inbox"));
  return found.map((issue) => `${c.lang} painel do sino: ${issue}`);
}

/**
 * A session at a small window (issue #135): the message box is whole inside the window and the
 * conversation keeps a minimum height, whatever the header and the summary take. 40% of the window
 * is out of reach at 720x480, where the title bar and the tabs already take about 190 px: the floor
 * is 150 px (the old three-line header left about 80).
 */
const MIN_CONVERSATION = 150;

async function sessionFitsProblems(c: Context): Promise<string[]> {
  await open(c, { name: "session", host: ALFA, id: c.ids.idleSession });
  await c.page.locator("[data-slot='composer-card']").first().waitFor({ timeout: WAIT });
  return c.page.evaluate((min) => {
    const found: string[] = [];
    const height = window.innerHeight;
    const card = document.querySelector<HTMLElement>("[data-slot='composer-card']");
    const at = card?.getBoundingClientRect();
    if (!at || at.top < 0 || at.bottom > height + 1) {
      found.push(
        `a caixa de mensagem sai da janela (${Math.round(at?.bottom ?? -1)} de ${height})`,
      );
    }
    const timeline = document.querySelector<HTMLElement>("[data-slot='timeline']");
    const room = timeline?.getBoundingClientRect().height ?? 0;
    if (room < min) {
      found.push(`a conversa tem só ${Math.round(room)} de ${height}`);
    }
    return found;
  }, MIN_CONVERSATION);
}

/**
 * The layout check (#1003), kept under the 90 s a journey gets: the screens people use most (Home,
 * a session, the board, a host's page, Settings) at the smallest window the app allows and at the
 * usual one. English runs all of it, in two journeys (`layoutWindows` is the second half); pt-BR runs
 * only the geometry guards, where its longer texts are the point. The other sizes and screens are
 * not checked here any more.
 */
export async function layout(c: Context, problems: string[]) {
  const screens: Array<[string, Route]> = [
    ["hub", { name: "hub" }],
    ["sessao", { name: "session", host: ALFA, id: c.ids.idleSession }],
    ["board", { name: "board", host: ALFA, projectId: c.ids.project }],
    ["host", { name: "host", host: ALFA }],
    ["configuracoes", { name: "settings" }],
  ];
  // The geometry guards (issue #192) name what they find by data-slot path; the heuristic rules fail
  // only when new against the baseline.
  await geometryGuards(c, screens, problems);
  if (c.lang === "pt-BR") return;
  const smallest = OVERFLOW_VIEWPORTS[0] as { width: number; height: number };
  const largest = OVERFLOW_VIEWPORTS[OVERFLOW_VIEWPORTS.length - 1] as typeof smallest;
  // Issue #103: with 12 tabs and a long worktree path, a screen does not scroll the page sideways.
  for (const viewport of [smallest, largest]) {
    await c.page.setViewportSize(viewport);
    await openCrowded(c, { name: "session", host: ALFA, id: c.ids.longSession });
    const where = `${c.lang} ${viewport.width}x${viewport.height} sessao-longa`;
    const crumbs = await crumbsProblem(c.page);
    if (crumbs) problems.push(`${where}: ${crumbs}`);
    const sideways = await pageScrollsSideways(c.page);
    if (sideways) problems.push(`${where} (12 abas): ${sideways}`);
  }
  // Widths that follow the title with 12 tabs and with 2, never under 80px; the list of all tabs,
  // with a long session title among them (#576).
  await c.page.setViewportSize(smallest);
  await openCrowded(c, { name: "hub" });
  const crowdedTabs = await tabWidthsProblem(c.page, 80);
  if (crowdedTabs)
    problems.push(`${c.lang} ${smallest.width}x${smallest.height} 12 abas: ${crowdedTabs}`);
  await openCrowded(c, { name: "hub" }, 2);
  const fewTabs = await tabWidthsProblem(c.page, 80);
  if (fewTabs) problems.push(`${c.lang} ${smallest.width}x${smallest.height} 2 abas: ${fewTabs}`);
  await openCrowded(c, { name: "session", host: ALFA, id: c.ids.longTitleSession });
  const tabList = await tabListProblem(c.page);
  if (tabList)
    problems.push(`${c.lang} ${smallest.width}x${smallest.height} lista de abas: ${tabList}`);
  // Which tab is open shows at a glance (#488), checked with two tabs at 1280x800.
  await c.page.setViewportSize({ width: 1280, height: 800 });
  await openCrowded(c, { name: "hub" }, 2);
  const activeTab = await activeTabProblem(c.page);
  if (activeTab) problems.push(`${c.lang} 1280x800 aba ativa: ${activeTab}`);
  // The tab strip starts at the same x whatever the crumbs say ("Hosts > alfa" is wider than
  // "Settings"); since #488 it has a row of its own over the area.
  const lefts: number[] = [];
  for (const [, route] of screens.filter(([n]) => n === "host" || n === "configuracoes")) {
    await open(c, route);
    const box = await c.page.locator(".tab-bar").first().boundingBox();
    if (box) lefts.push(Math.round(box.x));
  }
  if (new Set(lefts).size > 1) {
    problems.push(`${c.lang}: o início das abas muda com o título (${lefts.join(" ≠ ")})`);
  }
}

/**
 * The second half of the layout check (#1003), a journey of its own so each stays well under the
 * 90 s a journey gets (the whole check took 72 to 78 s on CI): the sidebar and page scroll at two
 * window sizes, a session opens at its end, the smallest window the app allows, and the bell.
 * English only, like the first half's extras.
 */
export async function layoutWindows(c: Context, problems: string[]) {
  // Issue #567: the sidebar scrolls as one area between its fixed header and footer, at the
  // usual window and at a short one, where it has to scroll at all. #785: the area around a Page
  // (the Host page, where the user saw two bars) does not scroll beside the page's own bar.
  for (const size of SCROLL_SIZES) {
    await c.page.setViewportSize(size);
    for (const route of [{ name: "hub" }, { name: "host", host: ALFA }] as Route[]) {
      await open(c, route);
      const found: Finding[] = await c.page.evaluate(layoutFindings, {
        single: SINGLE_SCROLL,
        pageArea: PAGE_AREA,
      });
      for (const split of found.filter((f) => f.rule === "scroll-split")) {
        problems.push(
          `${c.lang} ${size.width}x${size.height} ${route.name}: ${split.path} ${split.detail}`,
        );
      }
    }
  }
  // Issue #173: a session opens at its end and stays there while the page settles, so a pending
  // request is whole above the composer. Nothing scrolls the page before the measure.
  await c.page.setViewportSize({ width: 1280, height: 800 });
  await open(c, { name: "session", host: ALFA, id: c.ids.waitingSession });
  const pinned = await pinnedOnceSettled(c.page);
  if (pinned) problems.push(`${c.lang} waiting session: ${pinned}`);
  // The smallest window the app allows (tauri.conf.json), where the header and the dialog are tightest.
  await c.page.setViewportSize({ width: 720, height: 480 });
  for (const issue of await sessionFitsProblems(c)) {
    problems.push(`${c.lang} 720x480 sessão: ${issue}`);
  }
  problems.push(...(await bellPanelProblems(c)));
}

/** The windows the layout check uses: the smallest the app allows and the usual one (#1003). */
const LAYOUT_SIZES = GUARD_SIZES.filter((size) => size.width === 360 || size.width === 1280);

const BASELINE_FILE = join(import.meta.dirname, "../layout-findings-baseline.json");
const FINDINGS_FILE = join(process.cwd(), "playwright-report", "layout-findings.json");

/** Every screen at the layout sizes: findings by data-slot path, judged against the baseline. */
async function geometryGuards(c: Context, screens: Array<[string, Route]>, problems: string[]) {
  const baseline = loadBaseline(() =>
    existsSync(BASELINE_FILE) ? readFileSync(BASELINE_FILE, "utf8") : null,
  );
  const seen: Record<string, string> = {};
  const fixed: string[] = [];
  for (const size of LAYOUT_SIZES) {
    await c.page.setViewportSize(size);
    for (const [name, route] of screens) {
      await open(c, route);
      const screen = `${name}@${size.width}`;
      const found: Finding[] = await confirmGaps(
        () =>
          c.page.evaluate(layoutFindings, {
            // The key regions are a contract at the usual window: the smallest one is #135's business.
            regions: size.width >= 1280 ? KEY_REGIONS : [],
            bars: BARS,
            gaps: GAPS,
          }),
        // A toast that came after the page settled is still sliding: wait for it, then read again (#747).
        () => c.page.evaluate(waitForStable, { frames: 3, maxMs: 5000, boxes: GAP_BOXES }),
      );
      for (const finding of found) seen[findingKey(screen, finding)] = finding.detail;
      const verdict = judge(screen, found, baseline);
      problems.push(...verdict.failures);
      fixed.push(...verdict.fixed);
    }
  }
  // What the run saw, for the baseline file (the report folder is an artifact of the CI run).
  mkdirSync(dirname(FINDINGS_FILE), { recursive: true });
  writeFileSync(FINDINGS_FILE, JSON.stringify(seen, null, 2));
  if (fixed.length > 0) {
    problems.push(
      `layout-findings-baseline.json holds findings that are gone: remove\n${fixed.join("\n")}`,
    );
  }
}
