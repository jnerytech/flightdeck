/**
 * The steps of the BDD scenarios: written once, in English. The UI text a step looks for comes from
 * the dictionaries, in the language of the run (the same scenarios run in en and pt-BR).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatPairingLink } from "@flightdeck/protocol";
import { en } from "../../../apps/desktop/src/i18n/en.ts";
import { ptBR } from "../../../apps/desktop/src/i18n/pt-BR.ts";
import { VIEW_LABEL } from "../../../apps/desktop/src/lib/session-views.ts";
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
// A request's row says its tool; the session's finished turn, listed under Finished once the
// request is answered, has the same name and must not count as the request.
const request = (c: Context, session: string) =>
  c.page.locator(`main ul li button[aria-label*="${session}: Bash"]`);

step(Given, "I am on the new session screen of host {string}", async (c) =>
  open(c, { name: "new-session", host: ALFA }),
);

step(When, "I write the first prompt {string}", async (c, prompt = "") =>
  c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt),
);

step(When, "I create the session", async (c) =>
  c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click(),
);

step(Then, "the session opens showing my prompt {string}", async (c, prompt = "") => {
  // The session page has the message box; the form (or the palette) that held the text has none,
  // so the text alone would be found there too.
  await c.page
    .getByLabel(c.t("session.message"), { exact: true })
    .waitFor({ timeout: SESSION_WAIT });
  await c.page.getByText(prompt).first().waitFor({ timeout: SESSION_WAIT });
});

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
const made = new WeakMap<
  Context,
  { card?: string; project?: string; entry?: string; counts?: number[]; guard?: string }
>();
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

/** Finish… sits under the card page's menu (#1197). */
const fromCardMenu = async (c: Context, item: string) => {
  await c.page
    .getByRole("button", {
      name: c.t("board.cardActions", { title: mine(c).card ?? "" }),
      exact: true,
    })
    .click();
  await c.page.getByRole("menuitem", { name: item, exact: true }).click();
};

step(When, "I open the card and read the three ways to finish it", async (c) => {
  await tile(c)
    .getByRole("button", { name: mine(c).card ?? "", exact: true })
    .click();
  await fromCardMenu(c, c.t("cardUi.finish"));
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
  await fromCardMenu(c, c.t("cardUi.finish"));
  const dialog = c.page.getByRole("dialog", { name: c.t("cardUi.finishTitle") });
  await dialog.getByRole("button", { name: c.t("cardUi.finishMoveButton"), exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: WAIT });
});

step(Then, "the card says it is already done", async (c) => {
  await fromCardMenu(c, c.t("cardUi.finish"));
  await c.page
    .getByRole("dialog", { name: c.t("cardUi.finishTitle") })
    .getByText(c.t("cardUi.alreadyDone"), { exact: true })
    .waitFor({ timeout: WAIT });
});

// The board by keyboard and at a phone's width (#1198).
/** The title of the board card that has the focus, or "" when none has it. */
const focusedCard = (c: Context) =>
  c.page.evaluate(
    () =>
      document.activeElement
        ?.closest("[data-slot='board-columns'] li")
        ?.getAttribute("data-card") ?? "",
  );
/** The column of the board card that has the focus. */
const focusedColumn = (c: Context) =>
  c.page.evaluate(
    () => document.activeElement?.closest("section[data-column]")?.getAttribute("aria-label") ?? "",
  );

step(When, "I press Tab from the board's filter until a card has the focus", async (c) => {
  await c.page.getByLabel(c.t("kanban.filter"), { exact: true }).focus();
  // A few stops sit between the filter and the board (the toolbar, the return on cost card).
  for (let i = 0; i < 15 && (await focusedCard(c)) === ""; i++) await c.page.keyboard.press("Tab");
  await waitFor(async () => (await focusedCard(c)) !== "", "a board card with the focus");
});

step(Then, "the card that has the focus is in the column {string}", async (c, column = "") =>
  waitFor(async () => (await focusedColumn(c)) === columnName(c, column), `the focus in ${column}`),
);

step(
  When,
  "I press the right arrow until a card in the column {string} has the focus",
  async (c, column = "") => {
    for (let i = 0; i < 5 && (await focusedColumn(c)) !== columnName(c, column); i++) {
      await c.page.keyboard.press("ArrowRight");
    }
    await waitFor(
      async () => (await focusedColumn(c)) === columnName(c, column),
      `the focus in ${column}`,
    );
    const title = await c.page.evaluate(() => document.activeElement?.textContent ?? "");
    mine(c).card = title;
  },
);

step(When, "I press Enter on that card", async (c) => c.page.keyboard.press("Enter"));

step(Then, "that card opens", async (c) =>
  c.page
    .getByRole("heading", { name: mine(c).card ?? "", exact: true })
    .first()
    .waitFor({ timeout: WAIT }),
);

step(Given, "I open the board of the demo project at a phone's width", async (c) => {
  await c.page.setViewportSize({ width: 390, height: 844 });
  await open(c, { name: "board", host: ALFA, projectId: c.ids.project });
});

/** The board's columns that show, by name. */
const shownColumns = (c: Context) =>
  c.page
    .locator("[data-slot='board-columns'] > section[data-column]:not([hidden])")
    .evaluateAll((sections) => sections.map((s) => s.getAttribute("aria-label") ?? ""));

step(Then, "the board shows only the column {string}", async (c, column = "") => {
  const want = columnName(c, column);
  await waitFor(
    async () => JSON.stringify(await shownColumns(c)) === JSON.stringify([want]),
    `only ${column} on the board`,
  );
});

step(When, "I pick the column {string} from the board's column buttons", async (c, column = "") => {
  const name = columnName(c, column);
  await c.page
    .getByRole("group", { name: c.t("board.columns"), exact: true })
    .getByRole("button", { name: new RegExp(`^${name}, `) })
    .click();
});

// Set up Claude Code: a project the scenario makes, set up, then committed on a branch.
/** A git project of the scenario's own, with `files` committed, added to the host through the Add project dialog. */
async function addOwnProject(c: Context, files: Record<string, string> = {}) {
  const name = unique(c, "setup");
  const folder = join(dirname(c.ids.freshRepo), name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "README.md"), `# ${name}\n`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", folder, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "BDD");
  git("config", "user.email", "bdd@flightdeck.invalid");
  git("config", "commit.gpgsign", "false");
  git("add", ".");
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
}

step(Given, "a git project of my own is added to host {string}", async (c) => addOwnProject(c));

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

// The bell: a request that waits is answered in its row, without opening its session.
const bell = (c: Context) => c.page.getByRole("dialog");
const bellRequest = (c: Context, session: string) =>
  bell(c).getByRole("group", { name: new RegExp(session) });

step(Given, "the bell holds the request of {string}", async (c, session = "") => {
  // The web demo sends no notification: the request is put in the bell by hand.
  await open(c, { name: "needs-you" });
  await request(c, session).first().click({ timeout: SESSION_WAIT });
  const card = c.page.locator("fieldset[data-request-id]").first();
  await card.waitFor({ timeout: WAIT });
  const requestId = (await card.getAttribute("data-request-id")) ?? "";
  const link = `flightdeck://request?${new URLSearchParams({ host: ALFA, request: requestId })}`;
  const entry = `bell-${Date.now().toString(36)}`;
  mine(c).entry = entry;
  const seed = JSON.stringify([
    {
      id: entry,
      at: new Date().toISOString(),
      title: dictionary(c).inbox.title,
      body: "",
      link,
      subject: session,
      host: "alfa",
      ask: dictionary(c).inbox.runs.replace("{command}", "ls"),
      read: false,
    },
  ]);
  await c.page.evaluate((value) => localStorage.setItem("flightdeck.inbox", value), seed);
});

step(When, "I open the bell at a phone's width", async (c) => {
  await c.page.setViewportSize({ width: 390, height: 800 });
  await open(c, { name: "hub" });
  await c.page.getByRole("button", { name: new RegExp(`^${c.t("inbox.bell")}`) }).click();
  await bell(c).waitFor({ timeout: WAIT });
});

step(
  Then,
  "the request of {string} shows its risk and the buttons Approve and Deny",
  async (c, session = "") => {
    const row = bellRequest(c, session);
    await row.waitFor({ timeout: SESSION_WAIT });
    await row.getByText(c.t("approval.risk.medium"), { exact: true }).waitFor({ timeout: WAIT });
    await row.getByRole("button", { name: c.t("approval.approve"), exact: true }).waitFor();
    await row.getByRole("button", { name: c.t("approval.deny"), exact: true }).waitFor();
  },
);

step(Then, "the request row fits inside the panel", async (c) => {
  const fits = await bell(c).evaluate((box) => {
    const edge = box.getBoundingClientRect().right;
    const past = [...box.querySelectorAll<HTMLElement>(".inbox-request > *")].filter(
      (el) => el.getBoundingClientRect().right > edge + 1,
    );
    return box.scrollWidth <= box.clientWidth + 1 && past.length === 0;
  });
  if (!fits) throw new Error("the request row runs past the bell panel at 390 px");
});

step(When, "I approve the request of {string} from the bell", async (c, session = "") =>
  bellRequest(c, session)
    .getByRole("button", { name: c.t("approval.approve"), exact: true })
    .click(),
);

step(
  When,
  "I press the key {string} on the title of that request in the bell",
  async (c, key = "") => {
    const title = bell(c).locator(`[data-entry="${mine(c).entry}"] .inbox-pick`);
    await title.focus();
    await c.page.keyboard.press(key);
  },
);

step(Then, "the request of {string} leaves the bell", async (c, session = "") =>
  waitFor(async () => (await bellRequest(c, session).count()) === 0, "the request left the bell"),
);

step(Then, "the status says {string} was {string}", async (c, session = "", decision = "") => {
  const words = c.t(`approval.resolved.${decision === "approved" ? "allow" : "deny"}`);
  await c.page
    .getByRole("status")
    .filter({ hasText: `${session}: ${words}` })
    .first()
    .waitFor({ timeout: WAIT });
});

// Finished in Needs you (#1134): a session whose turn ended while the person was elsewhere.
/** The row of a request that waits, found by what it asks (a finished turn has the same session name). */
const waitingRow = (c: Context, session: string) =>
  c.page.locator(`main ul li button[aria-label*="${session}: Bash"]`);
const finishedRow = (c: Context, session: string) =>
  c.page.locator(
    `main ul li button[aria-label="alfa · ${session}: ${c.t("needsYou.finishedOutcome.done")}"]`,
  );

step(Then, "no request of {string} is waiting any more", async (c, session = "") =>
  waitFor(async () => (await waitingRow(c, session).count()) === 0, "the request left the queue"),
);

step(Then, "the Finished group lists {string} as finished", async (c, session = "") => {
  await c.page
    .getByRole("heading", { name: c.t("needsYou.finished"), exact: true })
    .waitFor({ timeout: SESSION_WAIT });
  await finishedRow(c, session).waitFor({ timeout: SESSION_WAIT });
});

step(When, "I choose the finished session {string}", async (c, session = "") =>
  finishedRow(c, session).click(),
);

step(
  Then,
  "its detail names the session, how it ended, and offers to see the changes",
  async (c) => {
    const detail = c.page.locator("main");
    await detail
      .getByText(new RegExp(`alfa · ${c.t("needsYou.finishedOutcome.done")} · `))
      .waitFor({ timeout: SESSION_WAIT });
    await detail.getByRole("button", { name: c.t("needsYou.seeChanges"), exact: true }).waitFor();
  },
);

step(When, "I choose to see the changes", async (c) =>
  c.page.getByRole("button", { name: c.t("needsYou.seeChanges"), exact: true }).click(),
);

step(Then, "the session opens on its Changes view", async (c) =>
  c.page
    .locator('[role="tab"][aria-selected="true"]', { hasText: c.t(VIEW_LABEL.changes) })
    .waitFor({ timeout: SESSION_WAIT }),
);

step(When, "I go back to the queue of what needs me", async (c) =>
  c.page
    .getByRole("button", { name: new RegExp(`^${c.t("sidebar.needsYou")}`) })
    .first()
    .click(),
);

step(Then, "the Finished group is gone", async (c) => {
  // Back on the page (the demo has other requests waiting, so its list is not empty).
  await c.page
    .getByRole("heading", { level: 1, name: c.t("sidebar.needsYou") })
    .waitFor({ timeout: WAIT });
  await waitFor(
    async () =>
      (await c.page
        .getByRole("heading", { name: c.t("needsYou.finished"), exact: true })
        .count()) === 0,
    "the Finished group is gone",
  );
});

// The sessions list (#1132): each row says its state in words, and its group counts the active ones.
step(When, "I open the sessions list", async (c) => open(c, { name: "hub" }));

/** A project group of the list, by its name. */
const hubGroup = (c: Context, project: string) =>
  c.page.getByRole("region", { name: c.t("hub.project", { name: project }), exact: true });
/** The word of a state in the app's language, by the English word a feature uses. */
const stateWord = (c: Context, word: string) => {
  const key = Object.entries(en.hub.rowWord).find(([, text]) => text === word)?.[0];
  if (!key) throw new Error(`no state word "${word}"`);
  return c.t(`hub.rowWord.${key}` as Parameters<Context["t"]>[0]);
};
/** A group with nothing that needs the person starts folded: the scenario unfolds it to read its rows. */
async function unfold(c: Context, project: string) {
  const toggle = hubGroup(c, project).getByRole("button", {
    name: c.t("hub.toggleProject", { name: project }),
    exact: true,
  });
  await toggle.waitFor({ timeout: WAIT });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

step(
  Given,
  "a session named {string} waits for approval in a folder of its own",
  async (c, name = "") => {
    // A folder of its own is a project group of its own: the row to look at is the only one in it.
    const folder = unique(c, "list");
    mkdirSync(join(dirname(c.ids.freshRepo), folder), { recursive: true });
    mine(c).project = folder;
    await open(c, { name: "new-session", host: ALFA });
    await c.page.getByRole("button", { name: c.t("newSession.moreOptions"), exact: true }).click();
    await c.page.getByLabel(c.t("newSession.subfolder"), { exact: true }).fill(folder);
    await c.page.getByLabel(c.t("newSession.name"), { exact: false }).fill(name);
    await c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill("[bash] ls");
    await c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click();
    await c.page
      .getByLabel(c.t("session.message"), { exact: true })
      .waitFor({ timeout: SESSION_WAIT });
  },
);

step(Then, "its project group has a session that says {string}", async (c, word = "") => {
  const group = mine(c).project ?? "";
  await hubGroup(c, group).waitFor({ timeout: SESSION_WAIT });
  await unfold(c, group);
  await hubGroup(c, group)
    .locator("li", { hasText: stateWord(c, word) })
    .first()
    .waitFor({ timeout: SESSION_WAIT });
});

step(Then, "that session says which tool it wants to run, {string}", async (c, tool = "") =>
  hubGroup(c, mine(c).project ?? "")
    .locator("li", { hasText: c.t("hub.rowDetail.waitingTool", { tool }) })
    .first()
    .waitFor({ timeout: WAIT }),
);

step(Then, "its project group counts its active sessions", async (c) =>
  hubGroup(c, mine(c).project ?? "")
    .getByText(pattern(dictionary(c).hub.countShort))
    .waitFor({ timeout: WAIT }),
);

// New session, task first (#1135): the task has the focus, the rest is folded, Ctrl+Enter starts it.
const promptBox = (c: Context) => c.page.getByLabel(c.t("newSession.prompt"), { exact: true });
const moreOptionsToggle = (c: Context) =>
  c.page.getByRole("button", { name: c.t("newSession.moreOptions"), exact: true });

step(Then, "the first prompt box has the focus", async (c) => {
  await promptBox(c).waitFor({ timeout: WAIT });
  await waitFor(
    () => promptBox(c).evaluate((el) => el === document.activeElement),
    "the first prompt has the focus",
  );
});

step(Then, "the name and the subfolder are folded under More options", async (c) => {
  await moreOptionsToggle(c).waitFor({ timeout: WAIT });
  await waitFor(
    async () =>
      (await moreOptionsToggle(c).getAttribute("aria-expanded")) === "false" &&
      !(await c.page.getByLabel(c.t("newSession.name"), { exact: false }).isVisible()),
    "the name is folded",
  );
});

step(When, "I open More options", async (c) => moreOptionsToggle(c).click());

step(Then, "the name and the subfolder boxes show", async (c) => {
  await c.page.getByLabel(c.t("newSession.name"), { exact: false }).waitFor({ timeout: WAIT });
  await c.page.getByLabel(c.t("newSession.subfolder"), { exact: true }).waitFor({ timeout: WAIT });
});

step(When, "I press Ctrl+Enter in the first prompt", async (c) =>
  promptBox(c).press("Control+Enter"),
);

// The palette starts a session from the text typed in it, in the project on screen.
const palette = (c: Context) => c.page.getByRole("dialog", { name: c.t("searchUi.label") });

step(When, "I open the command palette", async (c) => {
  await c.page.keyboard.press("Control+K");
  await palette(c).waitFor({ timeout: WAIT });
});

step(When, "I type {string} in the palette", async (c, text = "") =>
  c.page.getByLabel(c.t("searchUi.input"), { exact: true }).fill(text),
);

step(When, "I choose to start a session in {string} with that text", async (c, project = "") => {
  const text = await c.page.getByLabel(c.t("searchUi.input"), { exact: true }).inputValue();
  await c.page
    .getByRole("listbox", { name: c.t("palette.sectionStart"), exact: true })
    .getByRole("option", { name: c.t("palette.startIn", { project, text }) })
    .click({ timeout: WAIT });
});

// Review in the message box (#1146): comments on the lines of a session's Changes go to its message box.
step(
  Given,
  "a session of my own in a git folder with an edited file {string}",
  async (c, file = "") => {
    const folder = unique(c, "review");
    const dir = join(dirname(c.ids.freshRepo), folder);
    mkdirSync(dir, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "BDD");
    git("config", "user.email", "bdd@flightdeck.invalid");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, file), "first line\n");
    git("add", file);
    git("commit", "-q", "-m", "first");
    writeFileSync(join(dir, file), "first line, edited\n");
    mine(c).project = folder;
    await open(c, { name: "new-session", host: ALFA });
    await c.page.getByRole("button", { name: c.t("newSession.moreOptions"), exact: true }).click();
    await c.page.getByLabel(c.t("newSession.subfolder"), { exact: true }).fill(folder);
    await c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill("hello");
    await c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click();
    await c.page
      .getByLabel(c.t("session.message"), { exact: true })
      .waitFor({ timeout: SESSION_WAIT });
  },
);

step(When, "I open the Changes view of the session", async (c) =>
  c.page
    .getByRole("tab", { name: c.t(VIEW_LABEL.changes), exact: true })
    .click({ timeout: SESSION_WAIT }),
);

step(When, "I comment {string} on line 1 of {string}", async (c, text = "", file = "") => {
  await c.page
    .getByRole("button", { name: c.t("changes.commentLine", { line: 1, path: file }), exact: true })
    .click({ timeout: SESSION_WAIT });
  await c.page.getByLabel(c.t("changes.commentLabel"), { exact: true }).fill(text);
  await c.page.getByRole("button", { name: c.t("changes.addComment"), exact: true }).click();
});

step(When, "I hand the review over to the message box", async (c) =>
  c.page.getByRole("button", { name: c.t("changes.compose", { n: 1 }), exact: true }).click(),
);

step(
  Then,
  "the message box holds my comment {string} and the session is back on its conversation",
  async (c, text = "") => {
    await c.page
      .getByText(c.t("changes.composed"), { exact: true })
      .first()
      .waitFor({ timeout: WAIT });
    const box = c.page.getByLabel(c.t("session.message"), { exact: true });
    await waitFor(
      async () => (await box.inputValue()).includes(text),
      "the message box holds the review",
    );
  },
);

step(When, "I send the message", async (c) =>
  c.page.getByLabel(c.t("session.message"), { exact: true }).press("Enter"),
);

step(Then, "the conversation shows my review with {string}", async (c, text = "") => {
  // Sent: the box is empty again, and the text is in the conversation (the Changes view is closed).
  const box = c.page.getByLabel(c.t("session.message"), { exact: true });
  await waitFor(
    async () => (await box.inputValue()) === "",
    "the message box was emptied by the send",
  );
  await c.page.getByText(text).first().waitFor({ timeout: SESSION_WAIT });
});

// Card templates: a project's .flightdeck/templates/cards.json, offered by New card (issue #1201).
const TEMPLATE = {
  id: "bug",
  name: "Bug fix",
  description: "Reproduce it, fix it, prove it.",
  criteria: ["a test fails before the fix"],
  persona: "revisor",
  // A path inside the scenario's own repository, built so it is not read as a doc of this one.
  pins: [["docs", "specs", "bug-fix.md"].join("/")],
  spec: ["docs", "specs", "bug-fix.md"].join("/"),
};

step(Given, "a git project of my own with a card template is added to host {string}", async (c) =>
  addOwnProject(c, { ".flightdeck/templates/cards.json": JSON.stringify([TEMPLATE]) }),
);

step(Given, "I trust that project", async (c) => {
  await step_openProject(c);
  await c.page.getByRole("button", { name: c.t("projectPage.trust.action"), exact: true }).click();
  await c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("projectPage.trust.action"), exact: true })
    .click();
  await c.page
    .getByRole("button", { name: c.t("projectPage.trust.revoke"), exact: true })
    .waitFor({ timeout: WAIT });
});

async function step_openProject(c: Context) {
  await open(c, { name: "all-projects", host: ALFA });
  await c.page
    .locator(`li[data-project="${mine(c).project}"]`)
    .getByRole("button")
    .first()
    .click({
      timeout: WAIT,
    });
}

/** The board of the scenario's own project, opened from the host's project list. */
async function openOwnBoard(c: Context) {
  await open(c, { name: "projects", host: ALFA });
  await c.page
    .getByRole("button", { name: c.t("projectsUi.openBoard", { name: mine(c).project ?? "" }) })
    .click({ timeout: WAIT });
}

step(
  When,
  "I create a card from the template {string} with a title of my own",
  async (c, name = "") => {
    const title = unique(c, "bdd card");
    mine(c).card = title;
    await openOwnBoard(c);
    await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
    await c.page.getByLabel(c.t("kanban.template"), { exact: true }).selectOption({ label: name });
    await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
    await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
  },
);

step(
  Then,
  "the card starts with the template's criteria, spec file, pinned document and persona",
  async (c) => {
    await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
    const field = (label: string) => c.page.getByLabel(label, { exact: true });
    await waitFor(
      async () =>
        (await field(c.t("cardUi.description")).inputValue()).includes(
          `- [ ] ${TEMPLATE.criteria[0]}`,
        ),
      "the description has the template's criteria",
    );
    await waitFor(
      async () => (await field(c.t("cardUi.specFile")).inputValue()) === TEMPLATE.spec,
      "the spec file is the template's",
    );
    await c.page
      .getByRole("button", { name: c.t("cardUi.pins.unpin", { path: TEMPLATE.pins[0] ?? "" }) })
      .waitFor({ timeout: WAIT });
    // The persona is chosen in the start dialog, which Start opens for a card from a template.
    await c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
    const start = c.page.getByRole("dialog", { name: c.t("board.startCard") });
    await start.waitFor({ timeout: WAIT });
    await waitFor(
      async () =>
        (await start.getByLabel(c.t("personas.picker.card"), { exact: true }).inputValue()) ===
        `host:${TEMPLATE.persona}`,
      "the persona is the template's",
    );
  },
);

step(When, "I open New card on the board of that project", async (c) => {
  await openOwnBoard(c);
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
});

step(
  Then,
  "New card says the project's card templates were not used because it is not trusted",
  async (c) => {
    await c.page
      .getByText(c.t("kanban.templateIgnored.untrusted"), { exact: true })
      .waitFor({ timeout: WAIT });
    await c.page
      .getByLabel(c.t("kanban.template"), { exact: true })
      .waitFor({ state: "detached", timeout: WAIT });
  },
);

// Add a host: the first-run guide is on the page when a host exists too, and a pairing link fills the form (issue #1199).
step(When, "I open the Add a host page", async (c) => open(c, { name: "add-host" }));

step(Then, "the page lists the first steps with copy buttons for setup and doctor", async (c) => {
  const steps = c.page.getByRole("list", { name: c.t("welcome.stepsLabel"), exact: true });
  await steps.waitFor({ timeout: WAIT });
  const count = await steps.getByRole("listitem").count();
  if (count !== 4) throw new Error(`the guide has ${count} steps, not 4`);
  for (const command of ["flightdeckd setup", "flightdeckd doctor"]) {
    await c.page
      .getByRole("button", { name: c.t("welcome.copy", { command }), exact: true })
      .waitFor({ timeout: WAIT });
  }
});

/** The fold around the four manual fields, found by its summary. */
const manualFold = (c: Context) =>
  c.page.locator("details", { has: c.page.getByText(c.t("hostForm.byHand"), { exact: true }) });

step(
  Then,
  "the address and token fields are folded away and the pairing link is in view",
  async (c) => {
    await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).waitFor({ timeout: WAIT });
    const open = await manualFold(c).evaluate((details) => (details as HTMLDetailsElement).open);
    if (open) throw new Error("the manual fields are open before anything was typed");
  },
);

step(When, "I paste a pairing link named {string}", async (c, name = "") => {
  const link = formatPairingLink({ address: "100.64.0.9", port: 7421, name, token: "abc" });
  await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).fill(link);
});

step(Then, "the manual fields open with the name {string}", async (c, name = "") => {
  await waitFor(
    () => manualFold(c).evaluate((details) => (details as HTMLDetailsElement).open),
    "the manual fields open",
  );
  const field = c.page.getByLabel(c.t("hostForm.name"), { exact: true });
  await waitFor(async () => (await field.inputValue()) === name, "the name is filled");
});

// Start at boot: a host run from source (the demo) shows the command to run by hand and no Turn it on (issue #1200).
/** The command the Service row gives to run by hand: a command, not UI text. */
const SERVICE_COMMAND = "flightdeckd service install";
const serviceRow = (c: Context) =>
  c.page.getByRole("listitem", { name: c.t("hostDeps.names.service"), exact: true });

step(When, "I open the health of host {string}", async (c) =>
  open(c, { name: "host", host: ALFA }),
);

step(Then, "the Service row says it is missing and shows the command to run by hand", async (c) => {
  const row = serviceRow(c);
  await row.getByText(c.t("hostDeps.state.missing"), { exact: true }).waitFor({ timeout: WAIT });
  await row.getByText(SERVICE_COMMAND, { exact: true }).waitFor({ timeout: WAIT });
});

step(
  Then,
  "the app does not offer Turn it on, because this host does not run the installed binary",
  async (c) => {
    const row = serviceRow(c);
    await row.waitFor({ timeout: WAIT });
    const offered = await row
      .getByRole("button", { name: c.t("hostHealth.service.turnOn"), exact: true })
      .count();
    if (offered > 0) throw new Error("Turn it on is offered on a host that runs from source");
  },
);

// A card leads with its next step as one primary button; the rest waits in its menu (issue #1197).
step(When, "I open that card", async (c) => {
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
});

const cardMenu = (c: Context) =>
  c.page.getByRole("button", {
    name: c.t("board.cardActions", { title: mine(c).card ?? "" }),
    exact: true,
  });

step(Then, "its one main button is Start and Finish and Discard wait in its menu", async (c) => {
  await c.page
    .getByRole("button", { name: c.t("cardUi.start"), exact: true })
    .waitFor({ timeout: WAIT });
  const named = (name: string) => c.page.getByRole("button", { name, exact: true });
  // Not on the page until the menu opens.
  const loose = [c.t("cardUi.finish"), c.t("cardUi.discard")];
  for (const name of loose) {
    if ((await named(name).count()) > 0)
      throw new Error(`"${name}" is on the page, not in the menu`);
  }
  await cardMenu(c).click();
  for (const name of loose) {
    await c.page.getByRole("menuitem", { name, exact: true }).waitFor({ timeout: WAIT });
  }
  await c.page.keyboard.press("Escape");
});

step(When, "I press the main button", async (c) => {
  await c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
});

step(Then, "the main button now says Review changes, on the same button", async (c) => {
  // One element whatever the step is, so a person who pressed Start finds the focus still on it.
  const review = c.page.getByRole("button", { name: c.t("cardUi.reviewChanges"), exact: true });
  await review.waitFor({ timeout: SESSION_WAIT });
  await waitFor(
    () => review.evaluate((button) => button === document.activeElement),
    "the focus stays on the main button",
  );
});

// Run again: a card whose workflow run failed starts it again from the card (issue #1219).
// The check fails the first time and passes the second, so a run that starts again can finish.
const FLOW = "breaks";
const BREAKS =
  "steps:\n  - id: lint\n    check: 'test -e .bdd-attempt || { touch .bdd-attempt; exit 1; }'\n";

step(
  Given,
  "a git project of my own with a workflow that fails is added to host {string}",
  async (c) => addOwnProject(c, { [`.flightdeck/workflows/${FLOW}.yaml`]: BREAKS }),
);

step(Given, "I trust its workflow", async (c) => {
  await open(c, { name: "projects", host: ALFA });
  await c.page
    .getByRole("button", { name: c.t("projectsUi.workflows", { name: mine(c).project ?? "" }) })
    .click({ timeout: WAIT });
  await c.page.getByRole("button", { name: c.t("workflowsUi.trust", { name: FLOW }) }).click();
  await c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("workflowsUi.trustConfirm"), exact: true })
    .click();
  await c.page
    .getByRole("listitem", { name: c.t("workflowsUi.item", { name: FLOW }) })
    .getByText(c.t("workflowsUi.trusted"), { exact: true })
    .waitFor({ timeout: WAIT });
});

step(When, "I start a card of my own on that project with its workflow", async (c) => {
  const title = unique(c, "bdd card");
  mine(c).card = title;
  await openOwnBoard(c);
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
  await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
  await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
  await tile(c)
    .getByRole("button", { name: c.t("board.cardActions", { title }), exact: true })
    .click();
  await c.page.getByRole("menuitem", { name: c.t("board.startCard"), exact: true }).click();
  const start = c.page.getByRole("dialog", { name: c.t("board.startCard") });
  await start.getByLabel(c.t("cardUi.workflow"), { exact: true }).selectOption(FLOW);
  await start.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
  await start.waitFor({ state: "detached", timeout: WAIT });
});

step(Then, "the card offers Run again once the run has failed", async (c) => {
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  await c.page
    .getByRole("button", { name: c.t("runUi.again.action"), exact: true })
    .waitFor({ timeout: SESSION_WAIT });
});

step(When, "I press Run again", async (c) => {
  await c.page.getByRole("button", { name: c.t("runUi.again.action"), exact: true }).click();
});

step(Then, "the second run of the card completes", async (c) => {
  await c.page
    .getByRole("heading", {
      name: c.t("runUi.title", { name: FLOW, status: c.t("runUi.status.completed") }),
    })
    .waitFor({ timeout: SESSION_WAIT });
  await c.page
    .getByRole("button", { name: c.t("runUi.again.action"), exact: true })
    .waitFor({ state: "detached", timeout: WAIT });
});

// The quota in the status bar opens both windows of a host and the guard "new cards wait from N%" (issue #1218).
const quotaPanel = (c: Context) =>
  c.page.getByRole("dialog", { name: c.t("quota.popover.label"), exact: true });
const guardSelect = (c: Context, host: string) =>
  quotaPanel(c).getByLabel(c.t("quota.guard.labelFor", { host }), { exact: true });

step(Given, "I am on the queue of what needs me", async (c) => open(c, { name: "needs-you" }));

step(When, "I press the quota in the status bar", async (c) => {
  await c.page.locator('[data-slot="status-bar"] .status-quota').first().click({ timeout: WAIT });
  await quotaPanel(c).waitFor({ timeout: WAIT });
});

step(
  Then,
  "the panel shows the 5 hours and 7 days windows of host {string}",
  async (c, host = "") => {
    for (const window of ["five_hour", "seven_day"] as const) {
      const label = c.t("quota.meter", { window: c.t(`quota.windows.${window}`), host });
      await quotaPanel(c).getByLabel(label, { exact: true }).waitFor({ timeout: WAIT });
    }
  },
);

step(
  When,
  "I make new cards wait from {string} on host {string}",
  async (c, percent = "", host = "") => {
    const select = guardSelect(c, host);
    mine(c).guard = await select.inputValue();
    await select.selectOption({ label: percent });
  },
);

step(Then, "the guard of host {string} reads {string}", async (c, host = "", percent = "") => {
  await waitFor(
    () =>
      guardSelect(c, host).evaluate(
        (select, wanted) =>
          (select as HTMLSelectElement).selectedOptions[0]?.textContent === wanted,
        percent,
      ),
    `the guard reads ${percent}`,
  );
});

step(When, "I reload the app and open the quota again", async (c) => {
  await open(c, { name: "needs-you" });
  await c.page.locator('[data-slot="status-bar"] .status-quota').first().click({ timeout: WAIT });
  await quotaPanel(c).waitFor({ timeout: WAIT });
});

step(Then, "I put the guard of host {string} back to what it was", async (c, host = "") => {
  const before = mine(c).guard ?? "";
  await guardSelect(c, host).selectOption(before);
  await waitFor(
    async () => (await guardSelect(c, host).inputValue()) === before,
    "the guard is back",
  );
});
