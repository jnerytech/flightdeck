/**
 * The steps of the BDD scenarios: written once, in English. The UI text a step looks for comes from
 * the dictionaries, in the language of the run (the same scenarios run in en and pt-BR).
 */
import { en } from "../../../apps/desktop/src/i18n/en.ts";
import { ptBR } from "../../../apps/desktop/src/i18n/pt-BR.ts";
import { type Context, createSession, open, SESSION_WAIT, WAIT, waitFor } from "../journeys.ts";
import { Given, Then, When } from "./fixtures.ts";

type Step = (c: Context, ...args: string[]) => Promise<void>;
/** Registers a step under its English wording (playwright-bdd checks the arguments by count). */
const step = (kind: typeof Given | typeof When | typeof Then, text: string, run: Step) => {
  const count = text.match(/\{string\}/g)?.length ?? 0;
  if (count === 0) kind(text, async ({ c }) => run(c));
  else if (count === 1) kind(text, async ({ c }, a: string) => run(c, a));
  else kind(text, async ({ c }, a: string, b: string) => run(c, a, b));
};

const ALFA = "demo-alfa";
const request = (c: Context, session: string) =>
  c.page.locator("main ul li button", { hasText: session });

step(Given, "I am on the new session screen of host {string}", async (c) =>
  open(c, { name: "new-session", host: ALFA }),
);

step(When, "I write the first prompt {string}", async (c, prompt = "") =>
  c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt),
);

step(When, "I create the session", async (c) =>
  c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click(),
);

step(Then, "the session opens showing my prompt {string}", async (c, prompt = "") =>
  c.page.getByText(prompt).first().waitFor({ timeout: SESSION_WAIT }),
);

step(
  Given,
  "a session named {string} on {string} is waiting for me to approve a command",
  async (c, name) => createSession(c, "[bash] ls", name),
);

step(When, "I open the queue of what needs me", async (c) => open(c, { name: "needs-you" }));

step(When, "I open the request of {string}", async (c, session = "") =>
  request(c, session).first().click({ timeout: SESSION_WAIT }),
);

step(When, "I press the key {string} on the request", async (c, key = "") => {
  const card = c.page.locator("fieldset[data-request-id]").first();
  await card.waitFor({ timeout: WAIT });
  await card.focus();
  await c.page.keyboard.press(key);
});

step(Then, "the request of {string} leaves the queue", async (c, session = "") =>
  waitFor(async () => (await request(c, session).count()) === 0, "the request left the queue"),
);

// Simple mode (phase 33): the same daemon, shown to someone who never opens a terminal.
const simpleNav = (c: Context) => c.page.locator(`nav[aria-label="${c.t("simple.modeLabel")}"]`);

step(Given, "simple mode is on for {string}", async (c) => {
  // Only when the person has not chosen yet: a choice made later must survive a reload.
  await c.page.addInitScript(() => {
    if (!localStorage.getItem("flightdeck.uiMode")) {
      localStorage.setItem("flightdeck.uiMode", JSON.stringify({ "demo-alfa": "simple" }));
    }
  });
  await open(c, { name: "hub" });
  await simpleNav(c).waitFor({ timeout: WAIT });
});

step(When, "I start the task {string} on the notes folder", async (c, title = "") => {
  await c.page.getByRole("button", { name: title }).first().click();
  const dialog = c.page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(c.ids.notesFolder);
  await dialog.getByRole("button", { name: c.t("simple.home.start"), exact: true }).click();
});

step(When, "I answer yes to the question", async (c) =>
  c.page
    .getByRole("button", { name: c.t("simple.yes"), exact: true })
    .click({ timeout: SESSION_WAIT }),
);

step(Then, "the task is done", async (c) =>
  c.page
    .locator('[data-slot="task-chip"]', { hasText: c.t("simple.state.done") })
    .waitFor({ timeout: SESSION_WAIT }),
);

step(Then, "the file {string} is listed among the task's files", async (c, name = "") =>
  c.page.locator(".task-file-name", { hasText: name }).waitFor({ timeout: WAIT }),
);

step(When, "I choose to show everything in the settings", async (c) => {
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
});

step(Then, "the full app shows", async (c) =>
  simpleNav(c).waitFor({ state: "detached", timeout: WAIT }),
);

step(When, "I go back to simple mode from the page of host {string}", async (c) => {
  await open(c, { name: "host", host: ALFA });
  await c.page.getByRole("button", { name: c.t("hostPage.simpleUse"), exact: true }).click();
});

step(Then, "the home of simple mode shows", async (c) =>
  c.page.getByRole("heading", { name: c.t("simple.home.title") }).waitFor({ timeout: WAIT }),
);

// Return on cost (phase 36): the headline of the project page and the people table.
const dictionary = (c: Context) => (c.lang === "en" ? en : ptBR);
/** A regular expression for a dictionary text with its `{placeholders}` left open. */
const pattern = (template: string) =>
  new RegExp(
    template
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*"),
  );

step(
  Given,
  "the demo project finished more cards this month than in the period before",
  // The demo seed does it (the `demo-roi` test holds the numbers): nothing to do here.
  async () => {},
);

step(When, "I open the board of the demo project", async (c) =>
  open(c, { name: "board", host: ALFA, projectId: c.ids.project }),
);

step(Then, "the return on cost card says it delivered more than the period before", async (c) => {
  const roi = dictionary(c).roiUi;
  const card = c.page.getByRole("region", { name: roi.title });
  await card.getByText(pattern(roi.headline.more)).waitFor({ timeout: WAIT });
});

step(Given, "I am on the Costs screen", async (c) => open(c, { name: "costs" }));

step(
  When,
  "I add the person {string} on the first host with a monthly limit of {string} tokens",
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

step(
  Then,
  "the people table lists {string} against a limit of 5 million tokens",
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
