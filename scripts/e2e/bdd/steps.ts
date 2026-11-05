/** The steps of the BDD pilot: each is written once per language, and the UI text comes from the dictionaries. */
import { en } from "../../../apps/desktop/src/i18n/en.ts";
import { ptBR } from "../../../apps/desktop/src/i18n/pt-BR.ts";
import { type Context, createSession, open, SESSION_WAIT, WAIT, waitFor } from "../journeys.ts";
import { Given, Then, When } from "./fixtures.ts";

type Step = (c: Context, ...args: string[]) => Promise<void>;
type Words = { pt: string; en: string };

/** Registers a step under its Portuguese and English wording (playwright-bdd checks the arguments by count). */
const both = (kind: typeof Given | typeof When | typeof Then, words: Words, run: Step) => {
  for (const text of [words.pt, words.en]) {
    const count = text.match(/\{string\}/g)?.length ?? 0;
    if (count === 0) kind(text, async ({ c }) => run(c));
    else if (count === 1) kind(text, async ({ c }, a: string) => run(c, a));
    else kind(text, async ({ c }, a: string, b: string) => run(c, a, b));
  }
};

const ALFA = "demo-alfa";
const request = (c: Context, session: string) =>
  c.page.locator("main ul li button", { hasText: session });

both(
  Given,
  {
    pt: "que estou na tela de nova sessão do host {string}",
    en: "I am on the new session screen of host {string}",
  },
  async (c) => open(c, { name: "new-session", host: ALFA }),
);

both(
  When,
  { pt: "escrevo o primeiro prompt {string}", en: "I write the first prompt {string}" },
  async (
    c,
    prompt = "", // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) => c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt),
);

both(
  When,
  { pt: "crio a sessão", en: "I create the session" },
  async (
    c, // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) => c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click(),
);

both(
  Then,
  {
    pt: "a sessão abre mostrando o meu prompt {string}",
    en: "the session opens showing my prompt {string}",
  },
  async (c, prompt = "") => c.page.getByText(prompt).first().waitFor({ timeout: SESSION_WAIT }), // NOSONAR: async by contract: a throw must reach the caller as a rejection
);

both(
  Given,
  {
    pt: "que uma sessão chamada {string} em {string} espera eu aprovar um comando",
    en: "a session named {string} on {string} is waiting for me to approve a command",
  },
  async (c, name) => createSession(c, "[bash] ls", name),
);

both(
  When,
  { pt: "abro a fila do que precisa de mim", en: "I open the queue of what needs me" },
  async (c) => open(c, { name: "needs-you" }),
);

both(
  When,
  { pt: "abro o pedido de {string}", en: "I open the request of {string}" },
  async (c, session = "") => request(c, session).first().click({ timeout: SESSION_WAIT }), // NOSONAR: async by contract: a throw must reach the caller as a rejection
);

both(
  When,
  { pt: "aperto a tecla {string} no pedido", en: "I press the key {string} on the request" },
  async (c, key = "") => {
    const card = c.page.locator("fieldset[data-request-id]").first();
    await card.waitFor({ timeout: WAIT });
    await card.focus();
    await c.page.keyboard.press(key);
  },
);

both(
  Then,
  {
    pt: "o pedido de {string} sai da fila",
    en: "the request of {string} leaves the queue",
  },
  async (c, session = "") =>
    waitFor(async () => (await request(c, session).count()) === 0, "o pedido saiu da fila"),
);

// Simple mode (phase 33): the same daemon, shown to someone who never opens a terminal.
const simpleNav = (c: Context) => c.page.locator(`nav[aria-label="${c.t("simple.modeLabel")}"]`);

both(
  Given,
  { pt: "que o modo simples está ligado em {string}", en: "simple mode is on for {string}" },
  async (c) => {
    // Only when the person has not chosen yet: a choice made later must survive a reload.
    await c.page.addInitScript(() => {
      if (!localStorage.getItem("flightdeck.uiMode")) {
        localStorage.setItem("flightdeck.uiMode", JSON.stringify({ "demo-alfa": "simple" }));
      }
    });
    await open(c, { name: "hub" });
    await simpleNav(c).waitFor({ timeout: WAIT });
  },
);

both(
  When,
  {
    pt: "começo a tarefa {string} na pasta de notas",
    en: "I start the task {string} on the notes folder",
  },
  async (c, title = "") => {
    await c.page.getByRole("button", { name: title }).first().click();
    const dialog = c.page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(c.ids.notesFolder);
    await dialog.getByRole("button", { name: c.t("simple.home.start"), exact: true }).click();
  },
);

both(
  When,
  { pt: "respondo sim à pergunta", en: "I answer yes to the question" },
  async (
    c, // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) =>
    c.page
      .getByRole("button", { name: c.t("simple.yes"), exact: true })
      .click({ timeout: SESSION_WAIT }),
);

both(
  Then,
  { pt: "a tarefa termina", en: "the task is done" },
  async (
    c, // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) =>
    c.page
      .locator('[data-slot="task-chip"]', { hasText: c.t("simple.state.done") })
      .waitFor({ timeout: SESSION_WAIT }),
);

both(
  Then,
  {
    pt: "o arquivo {string} aparece entre os arquivos da tarefa",
    en: "the file {string} is listed among the task's files",
  },
  async (
    c,
    name = "", // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) => c.page.locator(".task-file-name", { hasText: name }).waitFor({ timeout: WAIT }),
);

both(
  When,
  {
    pt: "escolho mostrar tudo nas configurações",
    en: "I choose to show everything in the settings",
  },
  async (c) => {
    await simpleNav(c)
      .getByRole("button", { name: c.t("simple.nav.settings") })
      .click();
    await c.page
      .getByRole("button", { name: c.t("simple.settings.everything"), exact: true })
      .click();
    await c.page
      .getByRole("alertdialog")
      .getByRole("button", { name: c.t("simple.settings.everythingYes"), exact: true })
      .click();
  },
);

both(
  Then,
  { pt: "o app completo aparece", en: "the full app shows" },
  async (
    c, // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) => simpleNav(c).waitFor({ state: "detached", timeout: WAIT }),
);

both(
  When,
  {
    pt: "volto ao modo simples pela página do host {string}",
    en: "I go back to simple mode from the page of host {string}",
  },
  async (c) => {
    await open(c, { name: "host", host: ALFA });
    await c.page.getByRole("button", { name: c.t("hostPage.simpleUse"), exact: true }).click();
  },
);

both(
  Then,
  { pt: "o início do modo simples aparece", en: "the home of simple mode shows" },
  async (
    c, // NOSONAR: async by contract: a throw must reach the caller as a rejection
  ) => c.page.getByRole("heading", { name: c.t("simple.home.title") }).waitFor({ timeout: WAIT }),
);

// Return on cost (phase 36): the headline of the project page and the people table.
const dictionary = (c: Context) => (c.lang === "en" ? en : ptBR);
/** A regular expression for a dictionary text with its `{placeholders}` left open. */
const pattern = (template: string) =>
  new RegExp(
    template
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join(".*"),
  );

both(
  Given,
  {
    pt: "que o projeto da demo concluiu mais cards neste mês que no período anterior",
    en: "the demo project finished more cards this month than in the period before",
  },
  // The demo seed does it (the `demo-roi` test holds the numbers): nothing to do here.
  async () => {},
);

both(
  When,
  { pt: "abro o board do projeto da demo", en: "I open the board of the demo project" },
  async (c) => open(c, { name: "board", host: ALFA, projectId: c.ids.project }),
);

both(
  Then,
  {
    pt: "o cartão de retorno sobre o custo diz que entregou mais que o período anterior",
    en: "the return on cost card says it delivered more than the period before",
  },
  async (c) => {
    const roi = dictionary(c).roiUi;
    const card = c.page.getByRole("region", { name: roi.title });
    await card.getByText(pattern(roi.headline.more)).waitFor({ timeout: WAIT });
  },
);

both(Given, { pt: "que estou na tela de Custos", en: "I am on the Costs screen" }, async (c) =>
  open(c, { name: "costs" }),
);

both(
  When,
  {
    pt: "adiciono a pessoa {string} no primeiro host com limite mensal de {string} tokens",
    en: "I add the person {string} on the first host with a monthly limit of {string} tokens",
  },
  async (c, name = "", limit = "") => {
    const settings = dictionary(c).roiUi.settingsPanel;
    await c.page.getByLabel(settings.personName, { exact: true }).fill(name);
    await c.page
      .getByRole("group", { name: settings.personHosts })
      .getByRole("checkbox")
      .first()
      .check({ timeout: WAIT });
    await c.page.getByLabel(settings.tokenLimit, { exact: true }).fill(limit);
    await c.page.getByRole("button", { name: settings.addPerson, exact: true }).click();
  },
);

both(
  Then,
  {
    pt: "a tabela de pessoas lista {string} contra um limite de 5 milhões de tokens",
    en: "the people table lists {string} against a limit of 5 million tokens",
  },
  async (c, name = "") => {
    const people = dictionary(c).roiUi.people;
    const table = c.page.getByRole("table", { name: people.title });
    const row = table.getByRole("row").filter({ has: c.page.getByRole("rowheader", { name }) });
    const limit = people.tokens.million.replace("{n}", "5");
    await row.getByText(pattern(people.shareOfLimit.replace("{limit}", limit))).waitFor({
      timeout: WAIT,
    });
  },
);
