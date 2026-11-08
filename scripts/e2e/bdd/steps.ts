/**
 * The steps of the BDD scenarios: written once, in English. The UI text a step looks for comes from
 * the dictionaries, in the language of the run (the same scenarios run in en and pt-BR).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  // The host page opens on its Overview: the mode panel is in the Settings tab.
  await c.page.getByRole("tab", { name: c.t("hostHome.settings"), exact: true }).click();
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

// What a scenario makes for itself: the card it created, the project folder it added.
const made = new WeakMap<Context, { card?: string; project?: string }>();
const mine = (c: Context) => {
  const state = made.get(c) ?? {};
  made.set(c, state);
  return state;
};
const unique = (c: Context, what: string) =>
  `${what}-${c.lang}-${Date.now().toString(36)}`.toLowerCase();

// The board: a card is made, asked about before it starts, moved, and finished.
/** The column a feature names in English, by the key the dictionaries use. */
const columnKey = (name: string) => {
  const found = Object.entries(en.kanban.columns).find(([, text]) => text === name)?.[0];
  if (!found) throw new Error(`no column called "${name}"`);
  return found;
};
const columnName = (c: Context, name: string) =>
  c.t(`kanban.columns.${columnKey(name)}` as Parameters<Context["t"]>[0]);
const tile = (c: Context) =>
  c.page.locator(`li[aria-label="${c.t("kanban.card", { title: mine(c).card ?? "" })}"]`);

step(When, "I create a card with a title of my own", async (c) => {
  const title = unique(c, "bdd card");
  mine(c).card = title;
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
  await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
  await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
});

step(Then, "the card is in the column {string}", async (c, column = "") =>
  c.page
    .getByRole("region", { name: columnName(c, column), exact: true })
    .locator(`li[aria-label="${c.t("kanban.card", { title: mine(c).card ?? "" })}"]`)
    .waitFor({ timeout: WAIT }),
);

step(When, "I ask to start the card and then cancel", async (c) => {
  const title = mine(c).card ?? "";
  await tile(c)
    .getByRole("button", { name: c.t("board.cardActions", { title }), exact: true })
    .click();
  await c.page.getByRole("menuitem", { name: c.t("board.startCard"), exact: true }).click();
  const start = c.page.getByRole("dialog", { name: c.t("board.startCard") });
  await start.waitFor({ timeout: WAIT });
  await start.getByRole("button", { name: c.t("common.cancel"), exact: true }).click();
  await start.waitFor({ state: "detached", timeout: WAIT });
});

step(When, "I move the card to the column {string} from its menu", async (c, column = "") => {
  const title = mine(c).card ?? "";
  await tile(c)
    .getByRole("button", { name: c.t("board.cardActions", { title }), exact: true })
    .click();
  await c.page
    .getByRole("menuitem", {
      name: c.t("board.moveTo", { column: columnName(c, column) }),
      exact: true,
    })
    .click();
});

step(Then, "the board asks before moving it, saying the card lacks a PR link", async (c) => {
  const title = mine(c).card ?? "";
  const ask = c.page.getByRole("alertdialog", {
    name: c.t("board.contract.title", { column: columnName(c, "In review") }),
  });
  await ask
    .getByText(c.t("board.contract.lacksOne", { title, needs: c.t("board.contract.needs.pr") }), {
      exact: true,
    })
    .waitFor({ timeout: WAIT });
});

step(When, "I move it anyway", async (c) =>
  c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("board.contract.moveAnyway"), exact: true })
    .click(),
);

step(When, "I open the card and read the three ways to finish it", async (c) => {
  await tile(c)
    .getByRole("button", { name: mine(c).card ?? "", exact: true })
    .click();
  await c.page.getByRole("button", { name: c.t("cardUi.finish"), exact: true }).click();
  const dialog = c.page.getByRole("dialog", { name: c.t("cardUi.finishTitle") });
  for (const key of ["finishMove", "finishComplete", "finishMerge"] as const) {
    await dialog.getByText(c.t(`cardUi.${key}`), { exact: true }).waitFor({ timeout: WAIT });
  }
  // No worktree yet: the merge is off, and the dialog says why.
  await dialog.getByText(c.t("cardUi.finishNeedWorktree"), { exact: true }).waitFor();
  await c.page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: WAIT });
});

step(When, "I finish the card by moving it to Done", async (c) => {
  await c.page.getByRole("button", { name: c.t("cardUi.finish"), exact: true }).click();
  const dialog = c.page.getByRole("dialog", { name: c.t("cardUi.finishTitle") });
  await dialog.getByRole("button", { name: c.t("cardUi.finishMoveButton"), exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: WAIT });
});

step(Then, "the card says it is already done", async (c) => {
  await c.page.getByRole("button", { name: c.t("cardUi.finish"), exact: true }).click();
  await c.page
    .getByRole("dialog", { name: c.t("cardUi.finishTitle") })
    .getByText(c.t("cardUi.alreadyDone"), { exact: true })
    .waitFor({ timeout: WAIT });
});

// Set up Claude Code: a project the scenario makes, set up, then committed on a branch.
step(Given, "a git project of my own is added to host {string}", async (c) => {
  const name = unique(c, "setup");
  const folder = join(dirname(c.ids.freshRepo), name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "README.md"), `# ${name}\n`);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", folder, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "BDD");
  git("config", "user.email", "bdd@flightdeck.invalid");
  git("config", "commit.gpgsign", "false");
  git("add", "README.md");
  git("commit", "-q", "-m", "first");
  mine(c).project = name;
  await open(c, { name: "all-projects", host: ALFA });
  await c.page
    .getByRole("button", { name: c.t("projectsOverview.newProject"), exact: true })
    .click();
  const dialog = c.page.getByRole("dialog", { name: c.t("addProject.title"), exact: true });
  await dialog.getByLabel(c.t("addProject.folder"), { exact: true }).fill(folder);
  await dialog.getByRole("button", { name: c.t("addProject.add"), exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: WAIT });
});

step(When, "I open that project", async (c) => {
  await open(c, { name: "all-projects", host: ALFA });
  const row = c.page.locator(`li[data-project="${mine(c).project}"]`);
  await row.getByRole("button").click({ timeout: WAIT });
});

step(When, "I preview the Claude Code setup", async (c) => {
  await c.page
    .getByRole("button", { name: c.t("projectPage.harness.setup.action"), exact: true })
    .click();
});

step(Then, "the preview lists {string} among the new files", async (c, file = "") => {
  const dialog = c.page.getByRole("alertdialog");
  await dialog.getByText(c.t("projectPage.harness.setup.message"), { exact: true }).waitFor({
    timeout: WAIT,
  });
  await dialog.getByText(file, { exact: true }).first().waitFor({ timeout: WAIT });
});

step(When, "I apply the setup", async (c) => {
  await c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("projectPage.harness.setup.apply"), exact: true })
    .click();
});

step(Then, "the setup says which files it wrote", async (c) => {
  const done = c.t("projectPage.harness.setup.done", { files: "" }).trim();
  await c.page.getByRole("status").filter({ hasText: done }).waitFor({ timeout: WAIT });
});

step(When, "I commit the setup on a new branch", async (c) => {
  const commit = c.t("projectPage.harness.setup.commit");
  await c.page.getByRole("button", { name: commit, exact: true }).click();
  await c.page.getByRole("alertdialog").getByRole("button", { name: commit, exact: true }).click();
});

step(Then, "the setup says it was committed on a branch", async (c) => {
  const { committed } = dictionary(c).projectPage.harness.setup;
  await c.page
    .getByRole("status")
    .filter({ hasText: pattern(committed) })
    .waitFor({ timeout: WAIT });
});
