/**
 * The steps of the BDD scenarios: written once, in English. The UI text a step looks for comes from
 * the dictionaries, in the language of the run (the same scenarios run in en and pt-BR).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatPairingLink } from "@flightdeck/protocol";
import { DEMO_BACKUP_FOLDER, DEMO_BACKUP_FOLDER_KEY } from "../../../apps/desktop/src/demo/boot.ts";
import { SCHEDULE_KEY } from "../../../apps/desktop/src/features/backup/backup-schedule.ts";
import { TOKEN_MASK } from "../../../apps/desktop/src/features/hosts/domain/pairing-mask.ts";
import { HOSTS_KEY } from "../../../apps/desktop/src/features/hosts/hosts.ts";
import { AWAY_KEY } from "../../../apps/desktop/src/features/needs-you/away.ts";
import { VIEW_LABEL } from "../../../apps/desktop/src/features/sessions/session-views.ts";
import { en } from "../../../apps/desktop/src/i18n/en.ts";
import { ptBR } from "../../../apps/desktop/src/i18n/pt-BR.ts";
import {
  DEMO_ACTIVE_TEAM,
  DEMO_AWAY_FAILING_CARD,
  DEMO_AWAY_MERGED_CARD,
  DEMO_AWAY_SINCE,
  DEMO_GATE_CARD,
  DEMO_PR_CARD,
  DEMO_PR_URL,
  DEMO_TEAM_OUTCOME,
  DEMO_TEAM_REPORT,
} from "../../lib/e2e/journeys.ts";
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
  {
    card?: string;
    project?: string;
    entry?: string;
    counts?: number[];
    guard?: string;
    backup?: string;
    budgetHost?: string;
    budgetWindow?: string;
    backupFiles?: string[];
    origin?: string;
    cards?: string[];
    listsBefore?: number;
    head?: string;
    checkPid?: number;
  }
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
async function addOwnProject(
  c: Context,
  files: Record<string, string> = {},
  options: { origin?: boolean } = {},
) {
  const folder = makeOwnRepo(c, files, options);
  await addFolderToHost(c, ALFA, folder);
}

/** A git repository of the scenario's own, in the folder the demo host allows; `origin` gives it a bare remote. */
function makeOwnRepo(
  c: Context,
  files: Record<string, string> = {},
  options: { origin?: boolean } = {},
): string {
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
  if (options.origin) {
    // A local bare repository stands for the remote: the base branch is pushed there.
    const bare = `${folder}-origin.git`;
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { stdio: "ignore" });
    git("remote", "add", "origin", bare);
    git("push", "-q", "origin", "main");
    mine(c).origin = bare;
  }
  mine(c).project = name;
  return folder;
}

/** Adds a folder as a project of one host through the Add project dialog. */
async function addFolderToHost(c: Context, host: string, folder: string) {
  await open(c, { name: "all-projects", host });
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
const finishedRow = (c: Context, session: string, host = "alfa") =>
  c.page.locator(
    `main ul li button[aria-label="${host} · ${session}: ${c.t("needsYou.finishedOutcome.done")}"]`,
  );

// Issue #1478: a running session that says nothing is listed in Needs you (the demo counts a "minute" in seconds).
step(Given, "a session named {string} on {string} is running and says nothing", async (c, name) =>
  createSession(c, "[quiet] hold", name),
);

const quietRow = (c: Context, session: string) =>
  c.page.locator(
    `main ul li button[aria-label^="alfa · ${session}: ${c.t("needsYou.quietFor", { span: "" }).trim()}"]`,
  );

step(Then, "the queue lists {string} as quiet", async (c, session = "") =>
  quietRow(c, session).waitFor({ timeout: SESSION_WAIT }),
);

step(When, "I choose the quiet session {string}", async (c, session = "") =>
  quietRow(c, session).click(),
);

step(Then, "its detail offers to open it, interrupt it, send continue and snooze it", async (c) => {
  const detail = c.page.locator("main");
  for (const key of ["quietOpen", "quietInterrupt", "quietContinue", "quietSnooze"] as const) {
    await detail
      .getByRole("button", { name: c.t(`needsYou.${key}`), exact: true })
      .waitFor({ timeout: WAIT });
  }
});

step(When, "I interrupt the quiet session", async (c) =>
  c.page.getByRole("button", { name: c.t("needsYou.quietInterrupt"), exact: true }).click(),
);

step(Given, "the app counts the interrupts it asks of the hosts", async (c) => {
  await c.page.addInitScript(() => {
    const tap = window as unknown as { interruptsAsked: number };
    tap.interruptsAsked = 0;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.includes('"session.interrupt"'))
        tap.interruptsAsked += 1;
      send.call(this, data);
    };
  });
});

step(Then, "one interrupt was asked of the host", async (c) => {
  // The request leaves the page in the click that interrupts: the count is final by now.
  const asked = await c.page.evaluate(
    () => (window as unknown as { interruptsAsked?: number }).interruptsAsked ?? -1,
  );
  if (asked !== 1) throw new Error(`the page asked ${asked} interrupts, not 1`);
});

step(Then, "the queue no longer lists {string} as quiet", async (c, session = "") =>
  waitFor(
    async () => (await quietRow(c, session).count()) === 0,
    "the quiet session left the queue",
  ),
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

/** The project's Workflows page: the workflow `name` is trusted there. */
async function trustWorkflow(c: Context, name: string) {
  await open(c, { name: "projects", host: ALFA });
  await c.page
    .getByRole("button", { name: c.t("projectsUi.workflows", { name: mine(c).project ?? "" }) })
    .click({ timeout: WAIT });
  await c.page.getByRole("button", { name: c.t("workflowsUi.trust", { name }) }).click();
  await c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("workflowsUi.trustConfirm"), exact: true })
    .click();
  await c.page
    .getByRole("listitem", { name: c.t("workflowsUi.item", { name }) })
    .getByText(c.t("workflowsUi.trusted"), { exact: true })
    .waitFor({ timeout: WAIT });
}

step(Given, "I trust its workflow", async (c) => trustWorkflow(c, FLOW));

/** A card of the scenario's own is created on its project and started with the workflow `flow`. */
async function startCardWith(c: Context, flow: string) {
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
  await start.getByLabel(c.t("cardUi.workflow"), { exact: true }).selectOption(flow);
  await start.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
  await start.waitFor({ state: "detached", timeout: WAIT });
}

step(When, "I start a card of my own on that project with its workflow", async (c) =>
  startCardWith(c, FLOW),
);

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

// Settings > Backup: one encrypted file with everything, a restore that previews before it changes anything (issue #1241).
// The page's save dialog is replaced by one that keeps what is written; the file dialog of a restore is answered by the test.
const PASSPHRASE = "a long enough passphrase";
const WRONG_PASSPHRASE = "another long passphrase";
const backupField = (
  c: Context,
  key: "backupAll.passphrase" | "backupAll.confirm" | "backupAll.filePassphrase",
) => c.page.getByLabel(c.t(key), { exact: true });

step(Given, "I am on Settings > Backup and files are saved into the page", async (c) => {
  await open(c, { name: "settings", section: "backup" });
  await c.page.evaluate(() => {
    const kept = window as unknown as { __saved?: { name: string; text: string } };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (options: {
      suggestedName: string;
    }) => ({
      createWritable: async () => ({
        write: async (text: string) => {
          kept.__saved = { name: options.suggestedName, text };
        },
        close: async () => {},
      }),
    });
  });
  await c.page.getByLabel(c.t("backupAll.passphrase"), { exact: true }).waitFor({ timeout: WAIT });
});

const savedFile = (c: Context) =>
  c.page.evaluate(
    () => (window as unknown as { __saved?: { name: string; text: string } }).__saved ?? null,
  );

step(When, "I back up everything with a passphrase", async (c) => {
  await backupField(c, "backupAll.passphrase").fill(PASSPHRASE);
  await backupField(c, "backupAll.confirm").fill(PASSPHRASE);
  await c.page.getByRole("button", { name: c.t("backupAll.export"), exact: true }).click();
});

step(When, "I back up everything with two passphrases that differ", async (c) => {
  await backupField(c, "backupAll.passphrase").fill(PASSPHRASE);
  await backupField(c, "backupAll.confirm").fill(WRONG_PASSPHRASE);
  await c.page.getByRole("button", { name: c.t("backupAll.export"), exact: true }).click();
});

step(Then, "the panel says the backup was saved", async (c) => {
  await c.page.getByText(c.t("backupAll.saved"), { exact: true }).waitFor({ timeout: WAIT });
  const file = await savedFile(c);
  mine(c).backup = file?.text;
});

step(Then, "the saved file is encrypted and does not hold the passphrase", async (c) => {
  const file = await savedFile(c);
  if (!file) throw new Error("no file was saved");
  if (!file.text.startsWith("-----BEGIN AGE ENCRYPTED FILE-----")) {
    throw new Error("the saved file is not an encrypted file");
  }
  if (file.text.includes(PASSPHRASE)) throw new Error("the passphrase is in the file");
});

step(Then, "the panel says the passphrases do not match and nothing was saved", async (c) => {
  await c.page
    .getByText(c.t("backupAll.error.mismatch"), { exact: true })
    .waitFor({ timeout: WAIT });
  if ((await savedFile(c)) !== null) throw new Error("a file was saved");
});

/** Reads the backup made earlier in the scenario, answering the file dialog with it. */
async function readBackup(c: Context, passphrase: string) {
  const text = mine(c).backup;
  if (!text) throw new Error("no backup was made earlier in this scenario");
  await backupField(c, "backupAll.filePassphrase").fill(passphrase);
  const chooser = c.page.waitForEvent("filechooser");
  await c.page.getByRole("button", { name: c.t("backupAll.read"), exact: true }).click();
  await (await chooser).setFiles({
    name: "flightdeck-backup.fdbackup",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
}

step(When, "I read that backup with a wrong passphrase", async (c) =>
  readBackup(c, WRONG_PASSPHRASE),
);

step(When, "I read that backup with its passphrase", async (c) => readBackup(c, PASSPHRASE));

step(Then, "the panel says the file could not be read and offers no Restore", async (c) => {
  await c.page
    .getByText(c.t("backupAll.error.unreadable"), { exact: true })
    .waitFor({ timeout: WAIT });
  const restore = await c.page
    .getByRole("button", { name: c.t("backupAll.restore"), exact: true })
    .count();
  if (restore > 0) throw new Error("Restore is offered for a file that could not be read");
});

step(Then, "the panel previews what the backup holds and nothing is restored yet", async (c) => {
  const kinds = ["settings", "personas", "snippets", "hosts", "vault"] as const;
  await c.page
    .getByText(c.t("backupAll.nothingToRestore"), { exact: true })
    .waitFor({ timeout: WAIT });
  const body = ((await c.page.locator("body").textContent()) ?? "").toLowerCase();
  const first = c.t(`backupAll.kinds.${kinds[0]}`).toLowerCase();
  if (!body.includes(first)) throw new Error("the preview does not name the kinds it holds");
  const done = await c.page
    .getByText(c.t("backupAll.result", { added: "0", overwritten: "0", skipped: "0" }), {
      exact: false,
    })
    .count();
  if (done > 0) throw new Error("something was restored before the confirm");
});

// A workflow template added from the app: a new branch and a pull request, never the base branch (issue #1221).
step(
  Given,
  "a git project of my own with a remote and GitHub as its PR host is added to host {string}",
  async (c) => {
    await addOwnProject(c, {}, { origin: true });
    const name = mine(c).project ?? "";
    await open(c, { name: "projects", host: ALFA });
    await c.page
      .getByRole("button", { name: c.t("projectsUi.edit", { name }), exact: true })
      .click();
    await c.page.getByLabel(c.t("projectsUi.prProvider"), { exact: true }).selectOption("github");
    await c.page.getByRole("button", { name: c.t("projectsUi.save"), exact: true }).click();
    // The edit form closes once the host has the choice.
    await c.page
      .getByText(c.t("projectsUi.editTitle"), { exact: true })
      .waitFor({ state: "detached", timeout: WAIT });
  },
);

step(
  When,
  "I add the workflow template {string} to that project from its Workflows page",
  async (c, id = "") => {
    await open(c, { name: "projects", host: ALFA });
    await c.page
      .getByRole("button", { name: c.t("projectsUi.workflows", { name: mine(c).project ?? "" }) })
      .click({ timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("workflowsUi.templates.open"), exact: true })
      .click({ timeout: WAIT });
    await c.page.locator(`button[data-template="${id}"]`).click({ timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("workflowsUi.templates.add"), exact: true })
      .click({ timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("workflowsUi.templates.addGo"), exact: true })
      .click({ timeout: WAIT });
  },
);

step(
  Then,
  "the page says a pull request was opened from a new branch and offers to view it",
  async (c) => {
    await c.page
      .getByText(pattern(dictionary(c).workflowsUi.templates.added))
      .waitFor({ timeout: WAIT });
    await c.page
      .getByRole("button", { name: c.t("workflowsUi.templates.viewPr"), exact: true })
      .waitFor({ timeout: WAIT });
  },
);

step(
  Then,
  "the project's base branch and checkout are untouched and the remote has the new branch",
  async (c) => {
    const name = mine(c).project ?? "";
    const folder = join(dirname(c.ids.freshRepo), name);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" });
    const heads = execFileSync(
      "git",
      ["-C", mine(c).origin ?? "", "branch", "--list", "flightdeck/*"],
      {
        encoding: "utf8",
      },
    );
    if (!/flightdeck\/workflow-/.test(heads))
      throw new Error(`the remote has no workflow branch: ${heads}`);
    const onBase = git("ls-tree", "-r", "--name-only", "main");
    if (onBase.includes(".flightdeck/workflows"))
      throw new Error("the base branch holds the workflow");
    if (git("status", "--porcelain").trim() !== "") throw new Error("the checkout changed");
    if (git("rev-parse", "--abbrev-ref", "HEAD").trim() !== "main") throw new Error("HEAD moved");
  },
);

// Merge PR: the demo's In review card has an open pull request whose merge GitHub holds for a review.
const mergeButton = (c: Context) =>
  c.page.getByRole("button", { name: dictionary(c).cardMergePr.action, exact: true });

/** The In review card's detail page, from its tile on the board. */
async function openPrCard(c: Context) {
  const title = DEMO_PR_CARD;
  mine(c).card = title;
  await tile(c).getByRole("button", { name: title, exact: true }).click({ timeout: WAIT });
}

/** The Merge PR dialog of that card, with its pull request on show. */
async function askToMerge(c: Context) {
  await openPrCard(c);
  await mergeButton(c).click();
  const dialog = c.page.getByRole("alertdialog");
  await dialog.getByText(DEMO_PR_URL, { exact: true }).waitFor({ timeout: WAIT });
  return dialog;
}

step(When, "I open the card whose pull request is open and ask to merge it", async (c) => {
  await askToMerge(c);
});

step(When, "I choose to squash and merge", async (c) => {
  const text = dictionary(c).cardMergePr;
  const dialog = c.page.getByRole("alertdialog");
  await dialog.getByLabel(text.how, { exact: true }).selectOption({ label: text.squash });
  await dialog.getByRole("button", { name: text.action, exact: true }).click();
});

step(When, "I cancel the merge", async (c) => {
  const dialog = c.page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: c.t("common.cancel"), exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: WAIT });
});

step(Given, "the app counts the merges it asks of the hosts", async (c) => {
  await c.page.addInitScript(() => {
    const tap = window as unknown as { mergesAsked: number };
    tap.mergesAsked = 0;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.includes('"card.pr.merge"')) tap.mergesAsked += 1;
      send.call(this, data);
    };
  });
});

/** The merges the page has asked of a host since it loaded. */
const mergesAsked = (c: Context) =>
  c.page.evaluate(() => (window as unknown as { mergesAsked?: number }).mergesAsked ?? -1);

step(Then, "no merge was asked of any host", async (c) => {
  // The request leaves the page in the click that confirms, so nothing is still on its way.
  if ((await mergesAsked(c)) !== 0) throw new Error("the page asked a host to merge");
});

step(Then, "one merge was asked of the host", async (c) => {
  if ((await mergesAsked(c)) !== 1) throw new Error("the page did not ask exactly one merge");
});

step(
  Then,
  "the card says the merge waits for a review and links to the pull request",
  async (c) => {
    const refusal = c.page.getByRole("alert").filter({
      hasText: c.t("daemonRefusal.card_pr_review_required"),
    });
    await refusal.waitFor({ timeout: WAIT });
    await refusal
      .getByRole("link", { name: dictionary(c).cardMergePr.openPr, exact: true })
      .waitFor({ timeout: WAIT });
  },
);

step(Then, "the card still offers Merge PR", async (c) =>
  mergeButton(c).waitFor({ timeout: WAIT }),
);

// A team's outcome: the coordinator's report of the goal done, on top of the team's card (issue #1220).
const teamRow = (c: Context) =>
  c.page.getByRole("listitem", { name: c.t("teamsUi.row", { name: DEMO_ACTIVE_TEAM }) });

step(Given, "I open the Teams page of host {string}", async (c) =>
  open(c, { name: "teams", host: ALFA }),
);

/** The outcome box of the demo's active team, found by its title. */
const outcomeBox = (c: Context) =>
  teamRow(c).getByRole("region", { name: dictionary(c).teamsUi.outcome, exact: true });

step(Then, "the active team shows the coordinator's outcome marked Done", async (c) => {
  const box = outcomeBox(c);
  await box.getByText(DEMO_TEAM_OUTCOME, { exact: true }).waitFor({ timeout: WAIT });
  await box
    .getByText(dictionary(c).teamsUi.outcomeDone, { exact: true })
    .waitFor({ timeout: WAIT });
});

step(Then, "the outcome sits above the last report of each worker", async (c) => {
  const above = await outcomeBox(c).boundingBox();
  const report = await teamRow(c).getByText(DEMO_TEAM_REPORT).boundingBox();
  if (!above || !report) throw new Error("the outcome or the worker's report is not on the page");
  if (above.y + above.height > report.y) throw new Error("the outcome is not above the report");
});

step(Then, "the outcome can be reached with the keyboard", async (c) => {
  await outcomeBox(c).focus();
  await waitFor(
    async () => outcomeBox(c).evaluate((node) => node === document.activeElement),
    "the outcome box has the focus",
  );
});

// Scheduled backups: a folder, a cadence, the last files kept, a passphrase that lives in memory (issue #1264).
// The web build has no folder to write: the demo address `backupFolder=demo` gives the page one that keeps its files in the page.
const scheduleText = (c: Context) => dictionary(c).backupSchedule;
const withDemoFolder = { backupFolder: "demo" };
/** The cadence's radio button, by the name the dictionary gives it. */
const cadenceRadio = (c: Context, cadence: "off" | "daily" | "weekly") =>
  c.page.getByRole("radio", { name: scheduleText(c).cadence[cadence], exact: true });
const schedulePassphrase = (c: Context) =>
  c.page.getByLabel(scheduleText(c).passphrase, { exact: true });
/** The names of the files the demo's folder holds. */
const folderFiles = (c: Context) =>
  c.page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? Object.keys((JSON.parse(raw) as { files: object }).files).sort() : [];
  }, DEMO_BACKUP_FOLDER_KEY);

step(Given, "I am on Settings > Backup with a folder for scheduled backups", async (c) => {
  await open(c, { name: "settings", section: "backup" }, true, withDemoFolder);
  await cadenceRadio(c, "daily").waitFor({ timeout: WAIT });
});

step(When, "I turn on the daily backup and choose the folder", async (c) => {
  await cadenceRadio(c, "daily").check();
  await c.page.getByRole("button", { name: scheduleText(c).chooseFolder, exact: true }).click();
  await c.page.getByText(DEMO_BACKUP_FOLDER).waitFor({ timeout: WAIT });
});

step(Then, "the page says a backup is due and waits for the passphrase", async (c) => {
  await c.page
    .getByText(scheduleText(c).skipped["no-passphrase"], { exact: true })
    .waitFor({ timeout: WAIT });
  await schedulePassphrase(c).waitFor({ timeout: WAIT });
});

step(When, "I give the schedule a passphrase", async (c) => {
  await schedulePassphrase(c).fill(PASSPHRASE);
  await c.page.getByRole("button", { name: scheduleText(c).usePassphrase, exact: true }).click();
});

step(Then, "the page says the passphrase is set and when the last backup was made", async (c) => {
  await c.page.getByText(scheduleText(c).passphraseSet, { exact: true }).waitFor({ timeout: WAIT });
  await c.page.getByText(pattern(scheduleText(c).lastRun)).waitFor({ timeout: WAIT });
});

step(Then, "the folder holds {string} backup file", async (c, count = "") => {
  await waitFor(
    async () => (await folderFiles(c)).length === Number(count),
    `the folder holds ${count} file`,
  );
});

step(When, "a daily backup was made into the folder", async (c) => {
  if (!(await cadenceRadio(c, "daily").isChecked())) await cadenceRadio(c, "daily").check();
  await c.page.getByRole("button", { name: scheduleText(c).chooseFolder, exact: true }).click();
  await schedulePassphrase(c).fill(PASSPHRASE);
  await c.page.getByRole("button", { name: scheduleText(c).usePassphrase, exact: true }).click();
  await waitFor(async () => (await folderFiles(c)).length > 0, "the first backup is in the folder");
  mine(c).backupFiles = await folderFiles(c);
});

step(When, "I restart the app", async (c) => {
  await open(c, { name: "settings", section: "backup" }, true, withDemoFolder);
  await cadenceRadio(c, "daily").waitFor({ timeout: WAIT });
});

step(Then, "the daily backup is still on, with its folder", async (c) => {
  await waitFor(() => cadenceRadio(c, "daily").isChecked(), "the daily backup is still on");
  await c.page.getByText(DEMO_BACKUP_FOLDER).waitFor({ timeout: WAIT });
});

step(Then, "the passphrase is asked again", async (c) => {
  await schedulePassphrase(c).waitFor({ timeout: WAIT });
  await c.page
    .getByText(scheduleText(c).passphraseSet, { exact: true })
    .waitFor({ state: "detached", timeout: WAIT });
});

step(When, "I set the schedule to keep {string} file", async (c, count = "") => {
  await c.page.getByLabel(scheduleText(c).keep, { exact: true }).fill(count);
});

step(When, "two days pass and I restart the app", async (c) => {
  // The last backup is moved two days back in the page's storage, as the clock would have.
  await c.page.evaluate((key) => {
    const schedule = JSON.parse(window.localStorage.getItem(key) ?? "{}") as { lastRunAt: number };
    schedule.lastRunAt -= 2 * 24 * 3_600_000;
    window.localStorage.setItem(key, JSON.stringify(schedule));
  }, SCHEDULE_KEY);
  await open(c, { name: "settings", section: "backup" }, true, withDemoFolder);
  await cadenceRadio(c, "daily").waitFor({ timeout: WAIT });
});

step(Then, "that file is a newer backup than the first one", async (c) => {
  const [now] = await folderFiles(c);
  const [first] = mine(c).backupFiles ?? [];
  if (!now || !first || now <= first) throw new Error(`${now} is not newer than ${first}`);
});

// Budgets as a share of the plan quota (issues #1248, #1309). The demo host reads 62% of its 5-hour
// window. A budget of a project of the scenario's own measures nothing and holds no card of another
// project; one on the host is removed at the end of its scenario.
const budgetsText = (c: Context) => dictionary(c).budgetsUi;
const budgetsOf = (c: Context, host: string) =>
  c.page.getByRole("region", { name: c.t("budgetsUi.title", { host }), exact: true });
/** The windows a feature names, by the dictionary key of the "Measured in" option. */
const WINDOW_UNITS: Record<string, "unitFiveHour" | "unitSevenDay"> = {
  "5-hour": "unitFiveHour",
  weekly: "unitSevenDay",
};
const WINDOW_LABELS: Record<string, "fiveHour" | "sevenDay"> = {
  "5-hour": "fiveHour",
  weekly: "sevenDay",
};

step(Given, "I am on the budgets of host {string}", async (c, host = "") => {
  await open(c, { name: "settings", section: "budgets" });
  await budgetsOf(c, host).waitFor({ timeout: WAIT });
  mine(c).budgetHost = host;
});

/** The budget form's fields, in the section of the scenario's host. */
async function fillBudget(
  c: Context,
  scope: "host" | "project",
  percent: string,
  window: string,
  action: "notify" | "queue",
) {
  const section = budgetsOf(c, mine(c).budgetHost ?? "");
  const text = budgetsText(c);
  const unit = WINDOW_UNITS[window];
  if (!unit) throw new Error(`no window called "${window}"`);
  await section.getByLabel(text.scope, { exact: true }).selectOption({ label: text[scope] });
  if (scope === "project") {
    const key = `github.com/bdd/${unique(c, "budget")}`;
    mine(c).project = projectNameOf(key);
    const picker = section.getByLabel(text.projectLabel, { exact: true });
    if ((await picker.evaluate((node) => node.tagName)) === "SELECT") {
      await picker.selectOption({ label: text.otherProject });
      await section.getByLabel(text.keyLabel, { exact: true }).fill(key);
    } else await picker.fill(key);
  }
  await section.getByLabel(text.unit, { exact: true }).selectOption({ label: text[unit] });
  await section.getByLabel(text.limitPct, { exact: true }).fill(percent);
  await section
    .getByLabel(text.action, { exact: true })
    .selectOption({ label: dictionary(c).budgets[action] });
  await section.getByRole("button", { name: text.create, exact: true }).click();
}

/** What the list names a project budget after (the last part of its key). */
const projectNameOf = (key: string) => key.split("/").pop() ?? key;

step(
  When,
  "I add a host budget of {string} percent of the {string} window that notifies",
  async (c, percent = "", window = "") => {
    mine(c).budgetWindow = window;
    await fillBudget(c, "host", percent, window, "notify");
  },
);

step(
  When,
  "I add a budget for a project of my own of {string} percent of the {string} window that notifies",
  async (c, percent = "", window = "") => {
    mine(c).budgetWindow = window;
    await fillBudget(c, "project", percent, window, "notify");
  },
);

step(
  When,
  "I add a budget for a project of my own of {string} percent of the {string} window that holds new cards",
  async (c, percent = "", window = "") => {
    mine(c).budgetWindow = window;
    await fillBudget(c, "project", percent, window, "queue");
  },
);

/** The list entry of the scenario's budget: the host's in the window it set, or its project's. */
const budgetRow = (c: Context) =>
  budgetsOf(c, mine(c).budgetHost ?? "")
    .getByRole("listitem")
    .filter({ hasText: budgetRowLabel(c) });

step(
  Then,
  "the list shows that budget as {string} of the plan and past its limit",
  async (c, limit = "") => {
    const row = budgetRow(c);
    await row
      .getByText(pattern(dictionary(c).budgets.limitQuota.replace("{limit}", limit)))
      .first()
      .waitFor({ timeout: WAIT });
    // The meter reads how far the share is over its limit: the demo host is past half its 5-hour window.
    const meter = await row.getByRole("meter").first().getAttribute("aria-label");
    const percent = Number(/(\d+)%/.exec(meter ?? "")?.[1]);
    if (!(percent >= 100)) throw new Error(`the budget is not past its limit: ${meter}`);
  },
);

step(
  Then,
  "the list shows that budget as {string} of the plan and marked as an estimate",
  async (c, limit = "") => {
    const row = budgetRow(c);
    await row
      .getByText(pattern(dictionary(c).budgets.limitQuota.replace("{limit}", limit)))
      .first()
      .waitFor({ timeout: WAIT });
    await row
      .getByText(dictionary(c).budgets.estimate.trim(), { exact: false })
      .first()
      .waitFor({ timeout: WAIT });
  },
);

step(When, "I edit that budget into dollars with a limit of {string}", async (c, limit = "") => {
  const text = budgetsText(c);
  const section = budgetsOf(c, mine(c).budgetHost ?? "");
  await section
    .getByRole("button", {
      name: c.t("budgetsUi.edit", { label: budgetRowLabel(c) }),
      exact: true,
    })
    .click();
  await section.getByLabel(text.unit, { exact: true }).selectOption({ label: text.unitUsd });
  await section.getByLabel(text.limit, { exact: true }).fill(limit);
  await section.getByRole("button", { name: text.save, exact: true }).click();
  mine(c).budgetWindow = "";
});

/** The budget's label as the buttons name it (the window or period it is in). */
function budgetRowLabel(c: Context) {
  const budgets = dictionary(c).budgets;
  const window = WINDOW_LABELS[mine(c).budgetWindow ?? ""];
  const project = mine(c).project;
  return c.t("budgets.label", {
    scope: project ? c.t("budgets.scopeProject", { project }) : budgets.scopeHost,
    period: window ? budgets[window] : budgets.day,
  });
}

step(
  Then,
  "the list shows that one budget in dollars and not as a share of the plan",
  async (c) => {
    const row = budgetRow(c);
    await row
      .getByText(c.lang === "en" ? /US\$ 10\.00/ : /US\$ 10,00/)
      .first()
      .waitFor({ timeout: WAIT });
    const plan = dictionary(c).budgets.limitQuota.replace("{limit}", "");
    if ((await row.getByText(plan.trim()).count()) > 0)
      throw new Error("the budget is still a share of the plan");
    if ((await row.count()) !== 1) throw new Error("the edit made a second budget");
  },
);

step(Then, "the list shows that budget holding new cards", async (c) => {
  await budgetRow(c).getByText(dictionary(c).budgets.queue).first().waitFor({ timeout: WAIT });
});

step(Then, "I remove that budget", async (c) => {
  const section = budgetsOf(c, mine(c).budgetHost ?? "");
  await section
    .getByRole("button", {
      name: c.t("budgetsUi.remove", { label: budgetRowLabel(c) }),
      exact: true,
    })
    .click();
  await c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: budgetsText(c).removeConfirm, exact: true })
    .click();
  await budgetRow(c).waitFor({ state: "detached", timeout: WAIT });
});

step(Given, "I open the Costs page", async (c) => open(c, { name: "costs" }));

step(
  Then,
  "the plan quota of host {string} leads the page, above the cost charts",
  async (c, host = "") => {
    const lead = c.page.getByRole("region", { name: dictionary(c).costsUi.quotaLead, exact: true });
    await lead.getByText(dictionary(c).quota.windows.five_hour).first().waitFor({ timeout: WAIT });
    const charts = c.page.getByRole("region", { name: dictionary(c).costsUi.perDay, exact: true });
    await charts.waitFor({ timeout: WAIT });
    const [top, below] = [await lead.boundingBox(), await charts.boundingBox()];
    if (!top || !below || top.y + top.height > below.y)
      throw new Error(`the quota of ${host} does not lead the page`);
  },
);

// A card waiting at a gate leads with the gate's Approve, never with Open PR or Review changes (issue #1269).
step(When, "I open the card that waits at a workflow gate", async (c) => {
  mine(c).card = DEMO_GATE_CARD;
  await tile(c).getByRole("button", { name: DEMO_GATE_CARD, exact: true }).click({ timeout: WAIT });
});

step(Then, "the gate offers Approve and Deny", async (c) => {
  const gate = c.page.getByRole("region", { name: pattern(dictionary(c).runUi.gate) });
  await gate
    .getByRole("button", { name: dictionary(c).approval.approve, exact: true })
    .waitFor({ timeout: WAIT });
  await gate
    .getByRole("button", { name: dictionary(c).approval.deny, exact: true })
    .waitFor({ timeout: WAIT });
});

step(Then, "the card's run panel has no main button, only its menu", async (c) => {
  const run = c.page.locator('[data-slot="card-run"]');
  const menu = c.t("board.cardActions", { title: DEMO_GATE_CARD });
  await run.getByRole("button", { name: menu, exact: true }).waitFor({ timeout: WAIT });
  const names = await run
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? ""),
    );
  if (names.join("|") !== menu) throw new Error(`the run panel has more than its menu: ${names}`);
});

// Scheduled backups that cannot go reach the bell, once per start, and a press opens the schedule (issue #1327).
// A schedule a past session left on is put in the page's storage, as the app keeps it; the next load is the restart.
async function leaveSchedule(c: Context, folder: boolean) {
  await open(c, { name: "needs-you" }, true, withDemoFolder);
  await c.page.evaluate(
    ([scheduleKey, folderKey, chosen, path]) => {
      window.localStorage.setItem(
        scheduleKey as string,
        JSON.stringify({ cadence: "daily", folder: chosen ? path : "", keep: 5, lastRunAt: null }),
      );
      if (chosen)
        window.localStorage.setItem(
          folderKey as string,
          JSON.stringify({ chosen: true, files: {} }),
        );
      window.localStorage.removeItem("flightdeck.inbox");
    },
    [SCHEDULE_KEY, DEMO_BACKUP_FOLDER_KEY, folder, DEMO_BACKUP_FOLDER],
  );
}

step(
  Given,
  "a daily backup was left scheduled into the demo folder, with no passphrase",
  async (c) => leaveSchedule(c, true),
);

step(Given, "a daily backup was left scheduled with no folder", async (c) =>
  leaveSchedule(c, false),
);

step(When, "I restart the app on the queue of what needs me", async (c) => {
  await open(c, { name: "needs-you" }, true, withDemoFolder);
});

step(When, "I restart the app on Settings > Backup", async (c) => {
  await open(c, { name: "settings", section: "backup" }, true, withDemoFolder);
  await cadenceRadio(c, "daily").waitFor({ timeout: WAIT });
});

step(When, "I turn the schedule off and on again", async (c) => {
  await cadenceRadio(c, "off").check();
  await cadenceRadio(c, "daily").check();
  await c.page
    .getByText(scheduleText(c).skipped["no-passphrase"], { exact: true })
    .waitFor({ timeout: WAIT });
});

step(When, "I open the bell", async (c) => {
  // With a notice unread the bell says how many; Settings has a "Notifications" section too.
  await c.page.getByRole("button", { name: pattern(dictionary(c).inbox.bellUnread) }).click();
  await bell(c).waitFor({ timeout: WAIT });
});

/** The bell's entries that carry a title: how many there are, and none says it came more than once. */
async function oneNotice(c: Context, title: string) {
  const entries = bell(c).locator("li[data-entry]").filter({ hasText: title });
  await entries.first().waitFor({ timeout: WAIT });
  if ((await entries.count()) !== 1)
    throw new Error(`the bell holds ${await entries.count()} notices titled "${title}"`);
  if ((await bell(c).locator("li[data-entry]").count()) !== 1)
    throw new Error("the bell holds more than that notice");
  return entries;
}

step(
  Then,
  "the bell holds one notice that the scheduled backups need the passphrase",
  async (c) => {
    await oneNotice(c, scheduleText(c).attention.passphrase.title);
  },
);

step(Then, "the bell holds one notice that the scheduled backups have no folder", async (c) => {
  await oneNotice(c, scheduleText(c).attention["no-folder"].title);
});

step(When, "I press that notice", async (c) => {
  await (await oneNotice(c, scheduleText(c).attention.passphrase.title))
    .locator(".inbox-pick")
    .click();
});

step(Then, "the schedule opens and asks for the passphrase", async (c) => {
  await schedulePassphrase(c).waitFor({ timeout: WAIT });
});

// Run again from the failed step: the steps that finished are not run again (issues #1266, #1356).
// The first step leaves a line in a file of the card's worktree each time it runs; the second fails once.
const RESUMES = "resumes";
const resumesFlow = (second: string) =>
  `steps:\n  - id: first\n    check: 'echo ran >> .bdd-first'\n  - id: second\n    check: '${second}'\n`;
const FAILS_ONCE = "test -e .bdd-attempt || { touch .bdd-attempt; exit 1; }";
const resumesFile = `.flightdeck/workflows/${RESUMES}.yaml`;
/** The project's folder, where its base branch is checked out. */
const projectFolder = (c: Context) => join(dirname(c.ids.freshRepo), mine(c).project ?? "");
const gitIn = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" });
/** The card's worktree: the one that is not the project's own checkout. */
const cardWorktree = (c: Context) => {
  const listed = gitIn(projectFolder(c), "worktree", "list", "--porcelain");
  const paths = [...listed.matchAll(/^worktree (.+)$/gm)].map((m) => m[1] ?? "");
  const own = paths.find((path) => path !== projectFolder(c));
  if (!own) throw new Error(`the card has no worktree: ${listed}`);
  return own;
};

step(
  Given,
  "a git project of my own with a two-step workflow whose second step fails once is added to host {string}",
  async (c) => addOwnProject(c, { [resumesFile]: resumesFlow(FAILS_ONCE) }),
);

step(Given, "I trust its two-step workflow", async (c) => trustWorkflow(c, RESUMES));

step(When, "I start a card of my own on that project with the two-step workflow", async (c) =>
  startCardWith(c, RESUMES),
);

const resumeButton = (c: Context) =>
  c.page.getByRole("button", { name: c.t("runUi.again.resume", { step: "second" }), exact: true });

/** The card of the scenario, opened from its board. */
async function openOwnCard(c: Context) {
  await openOwnBoard(c);
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
}

step(Then, "the card offers to run again from the failed step", async (c) => {
  await openOwnCard(c);
  await resumeButton(c).waitFor({ timeout: SESSION_WAIT });
});

step(When, "I press Run again from the failed step", async (c) => resumeButton(c).click());

step(Then, "the run goes on and ends completed", async (c) => {
  await c.page
    .getByRole("heading", {
      name: c.t("runUi.title", { name: RESUMES, status: c.t("runUi.status.completed") }),
    })
    .waitFor({ timeout: SESSION_WAIT });
});

step(Then, "the first step ran once", async (c) => {
  const lines = readFileSync(join(cardWorktree(c), ".bdd-first"), "utf8")
    .trim()
    .split("\n");
  if (lines.length !== 1) throw new Error(`the first step ran ${lines.length} times`);
});

step(When, "the workflow file is changed on the base branch and trusted again", async (c) => {
  const folder = projectFolder(c);
  writeFileSync(join(folder, resumesFile), resumesFlow(`${FAILS_ONCE}; true`));
  gitIn(folder, "add", "--", resumesFile);
  gitIn(folder, "commit", "-q", "-m", "change the workflow");
  await trustWorkflow(c, RESUMES);
});

step(When, "the card's branch gets a new commit", async (c) => {
  const worktree = cardWorktree(c);
  writeFileSync(join(worktree, "moved.txt"), "moved\n");
  gitIn(worktree, "add", "--", "moved.txt");
  gitIn(worktree, "commit", "-q", "-m", "move the branch");
});

step(
  Then,
  "the card says why it cannot go on from the failed step: {string}",
  async (c, reason = "") => {
    await openOwnCard(c);
    const key = `daemonRefusal.${reason}` as Parameters<Context["t"]>[0];
    await c.page.getByText(c.t(key, { name: RESUMES })).waitFor({ timeout: SESSION_WAIT });
    if ((await resumeButton(c).count()) > 0)
      throw new Error("the card still offers to go on from the failed step");
    await c.page
      .getByRole("button", { name: c.t("runUi.again.action"), exact: true })
      .waitFor({ timeout: WAIT });
  },
);

// A card waits while the host's memory is at or over the threshold, and starts when it falls (issue #1343).
// The demo host reads its memory from a file the scenario writes; no file is no reading. The scenario puts
// the threshold and the file back as it found them.
const memoryGuardSelect = (c: Context, host: string) =>
  c.page.getByLabel(c.t("resources.guard.labelFor", { host }), { exact: true });

step(
  Given,
  "host alfa holds new cards from {string} of memory and reads {string} in use",
  async (c, pauseAt = "", used = "") => {
    await open(c, { name: "host", host: ALFA });
    const select = memoryGuardSelect(c, "alfa");
    await select.waitFor({ timeout: WAIT });
    mine(c).guard = await select.inputValue();
    await select.selectOption({ label: pauseAt });
    await waitFor(
      async () =>
        (await select.evaluate((node) => (node as HTMLSelectElement).selectedOptions[0]?.text)) ===
        pauseAt,
      "the hold is set",
    );
    writeFileSync(c.ids.memoryFile, String(Number.parseInt(used, 10) / 100));
  },
);

step(
  Given,
  "host alfa holds new cards from {string} of memory and has no memory reading",
  async (c, pauseAt = "") => {
    await open(c, { name: "host", host: ALFA });
    const select = memoryGuardSelect(c, "alfa");
    await select.waitFor({ timeout: WAIT });
    mine(c).guard = await select.inputValue();
    await select.selectOption({ label: pauseAt });
    rmSync(c.ids.memoryFile, { force: true });
  },
);

/** A card of the scenario's own on its project, started with its main button. */
async function startPlainCard(c: Context) {
  const title = unique(c, "bdd card");
  mine(c).card = title;
  await openOwnBoard(c);
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
  await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
  await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  await c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
}

step(When, "I start a card of my own on that project from its main button", async (c) =>
  startPlainCard(c),
);

step(Then, "the card says it is waiting for memory", async (c) => {
  await openOwnBoard(c);
  await tile(c).getByText(c.t("kanban.waitingMemory"), { exact: true }).waitFor({ timeout: WAIT });
});

step(When, "the memory of host alfa falls to {string} in use", async (c, used = "") => {
  writeFileSync(c.ids.memoryFile, String(Number.parseInt(used, 10) / 100));
});

/** What the card leads with once it has started: its changes to review, or the PR to open when it already finished. */
const startedLead = (c: Context) =>
  c.page
    .getByRole("button", { name: c.t("cardUi.reviewChanges"), exact: true })
    .or(c.page.getByRole("button", { name: c.t("cardUi.openPr"), exact: true }));

step(Then, "the card starts and no longer waits for memory", async (c) => {
  // The host looks at its memory again every 15 s while it holds.
  await tile(c)
    .getByText(c.t("kanban.waitingMemory"), { exact: true })
    .waitFor({ state: "detached", timeout: SESSION_WAIT });
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  await startedLead(c).waitFor({ timeout: SESSION_WAIT });
});

step(Then, "the card starts at once and never waits for memory", async (c) => {
  // Still on the card, whose main button changed from Start.
  await startedLead(c).waitFor({ timeout: SESSION_WAIT });
  await openOwnBoard(c);
  if ((await tile(c).getByText(c.t("kanban.waitingMemory"), { exact: true }).count()) > 0)
    throw new Error("the card waited for memory");
});

step(Then, "I put the memory hold of host alfa back to what it was", async (c) => {
  rmSync(c.ids.memoryFile, { force: true });
  await open(c, { name: "host", host: ALFA });
  await memoryGuardSelect(c, "alfa").selectOption(mine(c).guard ?? "");
});

// While you were away: after a long absence, Needs you opens with what each host did (issues #1344, #1369).
const summaryOf = (c: Context) =>
  c.page.getByRole("region", { name: dictionary(c).away.title, exact: true });

/** A host's part of the summary: the box that holds its name and its groups. */
const awayHost = (c: Context, host: string) =>
  summaryOf(c).locator(`xpath=.//h3[normalize-space()="${host}"]/..`);

/** The lines of a group in a host's part, by the group's heading (its count is left open). */
const awayGroup = (c: Context, host: string, title: string) => {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return awayHost(c, host)
    .getByRole("heading", { name: new RegExp(`^${escaped} \\(\\d+\\)$`) })
    .locator("xpath=following-sibling::ul[1]");
};

/** Any page of the demo holds the window's storage; `time` is when the app was last active. */
async function lastActive(c: Context, time: string) {
  if (!c.page.url().startsWith(c.url)) await c.page.goto(c.url);
  await c.page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [AWAY_KEY, time],
  );
}

step(Given, "the app was last active long ago", async (c) => lastActive(c, DEMO_AWAY_SINCE));

step(Given, "the app was last active a moment ago", async (c) =>
  lastActive(c, new Date().toISOString()),
);

step(Given, "two hours pass", async (c) => {
  // The page's clock moves; the hosts keep theirs, so nothing they did is after the last time.
  await c.page.clock.setSystemTime(Date.now() + 2 * 3_600_000);
});

step(When, "I open Needs you", async (c) => open(c, { name: "needs-you" }));

step(
  Then,
  "the summary tells what alfa did: finished sessions, cards in review and the quota used",
  async (c) => {
    const text = dictionary(c).away;
    await summaryOf(c).waitFor({ timeout: WAIT });
    await awayGroup(c, "alfa", text.sessions).waitFor({ timeout: WAIT });
    await awayGroup(c, "alfa", text.review).waitFor({ timeout: WAIT });
    await awayHost(c, "alfa").getByText(pattern(text.quota)).waitFor({ timeout: WAIT });
  },
);

step(
  Then,
  "the summary tells what beta did: a merged pull request, a pull request with failing checks and cards in review",
  async (c) => {
    const text = dictionary(c).away;
    const said = (template: string, title: string) => template.replace("{title}", title);
    await summaryOf(c).waitFor({ timeout: WAIT });
    const prs = awayGroup(c, "beta", text.prs);
    await prs
      .getByRole("button", { name: said(text.merged, DEMO_AWAY_MERGED_CARD), exact: true })
      .waitFor({ timeout: WAIT });
    await prs
      .getByRole("button", { name: said(text.checksFailed, DEMO_AWAY_FAILING_CARD), exact: true })
      .waitFor({ timeout: WAIT });
    const review = awayGroup(c, "beta", text.review);
    await review
      .getByRole("button", { name: DEMO_AWAY_FAILING_CARD, exact: true })
      .waitFor({ timeout: WAIT });
  },
);

step(When, "I follow the merged pull request line of beta", async (c) => {
  const text = dictionary(c).away;
  await awayGroup(c, "beta", text.prs)
    .getByRole("button", {
      name: text.merged.replace("{title}", DEMO_AWAY_MERGED_CARD),
      exact: true,
    })
    .click({ timeout: WAIT });
});

step(Then, "the card of that pull request opens", async (c) => {
  await c.page.getByText(DEMO_AWAY_MERGED_CARD, { exact: true }).first().waitFor({ timeout: WAIT });
});

step(Then, "the summary is gone", async (c) => {
  await summaryOf(c).waitFor({ state: "detached", timeout: WAIT });
});

// A failed run's line is a link once the app knows its card: the card's page, opened in the app, tells it.
step(When, "I look at my card", async (c) => {
  await openOwnCard(c);
  await c.page
    .getByRole("button", { name: c.t("runUi.again.action"), exact: true })
    .waitFor({ timeout: SESSION_WAIT });
});

step(When, "I go to Needs you from the sidebar", async (c) => {
  await c.page
    .getByRole("button", { name: new RegExp(`^${c.t("sidebar.needsYou")}`) })
    .first()
    .click({ timeout: WAIT });
});

step(Then, "the summary lists the failed run of my card under alfa", async (c) => {
  const runs = awayGroup(c, "alfa", dictionary(c).away.runs);
  await runs
    .getByRole("button", { name: new RegExp(`^${FLOW}`) })
    .first()
    .waitFor({ timeout: WAIT });
});

step(When, "I follow the failed run line of alfa", async (c) => {
  await awayGroup(c, "alfa", dictionary(c).away.runs)
    .getByRole("button", { name: new RegExp(`^${FLOW}`) })
    .first()
    .click({ timeout: WAIT });
});

step(Then, "my card opens", async (c) => {
  // The card's page has Run again for its failed run; the board and the summary have none.
  await c.page
    .getByRole("button", { name: c.t("runUi.again.action"), exact: true })
    .waitFor({ timeout: SESSION_WAIT });
  await c.page
    .getByText(mine(c).card ?? "", { exact: true })
    .first()
    .waitFor({ timeout: WAIT });
});

step(When, "I dismiss the summary", async (c) => {
  await summaryOf(c)
    .getByRole("button", { name: dictionary(c).away.dismiss, exact: true })
    .click({ timeout: WAIT });
});

step(Then, "there is no summary", async (c) => {
  // Needs you is drawn and the hosts have answered before the absence of a summary counts.
  await c.page
    .getByRole("heading", { name: c.t("needsYou.title") })
    .first()
    .waitFor({ timeout: WAIT });
  const until = Date.now() + 2000;
  do {
    if ((await summaryOf(c).count()) > 0) throw new Error("the summary is on screen");
    await c.page.waitForTimeout(100);
  } while (Date.now() < until);
});

step(Given, "host beta does not answer what happened while the app was closed", async (c) => {
  if (!c.page.url().startsWith(c.url)) await c.page.goto(c.url);
  const hosts = (await c.page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
    HOSTS_KEY,
  )) as Array<{ id: string; url: string }>;
  const beta = hosts.find((host) => host.id === "demo-beta")?.url;
  if (!beta) throw new Error("the demo has no host beta");
  // Everything goes to the real host, but the one question: that one is answered with a refusal, in
  // the page, as the host would. (Routing the sockets through Playwright left the app without hosts.)
  await c.page.addInitScript((address) => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (this.url === address && typeof data === "string" && data.includes('"activity.since"')) {
        const frame = JSON.parse(data) as { id: string };
        const nack = {
          type: "ack",
          id: frame.id,
          ok: false,
          error: { code: "internal", message: "no answer" },
        };
        setTimeout(
          () => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(nack) })),
          0,
        );
        return;
      }
      send.call(this, data);
    };
  }, beta);
});

step(Then, "the summary says beta did not answer", async (c) => {
  await summaryOf(c)
    .getByText(dictionary(c).away.unreached.replace("{host}", "beta"), { exact: true })
    .waitFor({ timeout: WAIT });
});

// Pull requests: every open PR of the hosts on one page, and what can be done to each (issue #1345).
const prList = (c: Context) =>
  c.page.getByRole("list", { name: dictionary(c).pullRequests.list, exact: true });
const prRow = (c: Context, title: string) =>
  prList(c)
    .locator("[data-slot='pr-row']")
    .filter({ has: c.page.getByRole("heading", { name: title, exact: true }) });

step(When, "I open the Pull requests page", async (c) => open(c, { name: "pull-requests" }));

step(Then, "it lists the pull request of the card on alfa that can be merged", async (c) => {
  const row = prRow(c, DEMO_PR_CARD);
  await row.waitFor({ timeout: WAIT });
  await row.getByText(/^alfa/).waitFor({ timeout: WAIT });
});

step(Then, "it lists the pull request of the card on beta with failing checks", async (c) => {
  const row = prRow(c, DEMO_AWAY_FAILING_CARD);
  await row.waitFor({ timeout: WAIT });
  await row.getByText(/^beta/).waitFor({ timeout: WAIT });
  await row.getByText(c.t("checks.failing"), { exact: true }).waitFor({ timeout: WAIT });
});

const prMerge = (c: Context, title: string) =>
  prRow(c, title).getByRole("button", { name: dictionary(c).cardMergePr.action, exact: true });

step(Then, "the pull request on alfa offers Merge PR", async (c) => {
  await prMerge(c, DEMO_PR_CARD).waitFor({ timeout: WAIT });
});

step(Then, "the pull request on beta with failing checks does not", async (c) => {
  // The row is there, so its missing button is not a missing row.
  await prRow(c, DEMO_AWAY_FAILING_CARD).waitFor({ timeout: WAIT });
  if ((await prMerge(c, DEMO_AWAY_FAILING_CARD).count()) > 0)
    throw new Error("a pull request whose checks fail offers Merge PR");
});

step(When, "I ask to merge the pull request on alfa", async (c) => {
  await prMerge(c, DEMO_PR_CARD).click({ timeout: WAIT });
});

step(Then, "the dialog shows the address of that pull request", async (c) => {
  await c.page
    .getByRole("alertdialog")
    .getByText(DEMO_PR_URL, { exact: true })
    .waitFor({ timeout: WAIT });
});

step(Then, "the page says the merge waits for a review", async (c) => {
  await c.page
    .getByRole("alert")
    .filter({ hasText: c.t("daemonRefusal.card_pr_review_required") })
    .waitFor({ timeout: WAIT });
});

// Pause new runs on a host: a started card waits, the status bar names the host, resuming releases it (issue #1404).
const pauseSwitch = (c: Context, paused: boolean) =>
  c.page.getByRole("button", {
    name: dictionary(c).hostPage[paused ? "pauseTurnOff" : "pauseTurnOn"],
    exact: true,
  });

/** The host page's Settings tab, where the pause switch is. */
async function openHostSettings(c: Context) {
  await open(c, { name: "host", host: ALFA });
  await c.page
    .getByRole("tab", { name: dictionary(c).hostHome.settings, exact: true })
    .click({ timeout: WAIT });
}

step(Given, "new runs are not paused on host alfa", async (c) => {
  // A scenario that failed half way may have left the host paused.
  await openHostSettings(c);
  await pauseSwitch(c, false).or(pauseSwitch(c, true)).waitFor({ timeout: WAIT });
  if ((await pauseSwitch(c, true).count()) > 0) await pauseSwitch(c, true).click();
  await pauseSwitch(c, false).waitFor({ timeout: WAIT });
});

step(When, "I pause new runs on host alfa", async (c) => {
  await openHostSettings(c);
  await pauseSwitch(c, false).click({ timeout: WAIT });
  await pauseSwitch(c, true).waitFor({ timeout: WAIT });
});

step(When, "I resume new runs on host alfa", async (c) => {
  await openHostSettings(c);
  await pauseSwitch(c, true).click({ timeout: WAIT });
  await pauseSwitch(c, false).waitFor({ timeout: WAIT });
});

step(Then, "the card says it waits because the host is paused", async (c) => {
  await openOwnBoard(c);
  await tile(c).getByText(c.t("kanban.waitingPaused"), { exact: true }).waitFor({ timeout: WAIT });
});

step(Then, "the status bar names host alfa as paused", async (c) => {
  const text = dictionary(c).statusBar.paused;
  const named = (template: string) =>
    c.page.getByRole("button", { name: pattern(template.replace("{host}", "alfa")) });
  await named(text.running).or(named(text.idle)).first().waitFor({ timeout: WAIT });
});

step(Then, "the card starts and no longer waits for the pause", async (c) => {
  await openOwnBoard(c);
  await tile(c)
    .getByText(c.t("kanban.waitingPaused"), { exact: true })
    .waitFor({ state: "detached", timeout: SESSION_WAIT });
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  await startedLead(c).waitFor({ timeout: SESSION_WAIT });
});

// Conflict radar: cards of one project that change the same file flag each other (issue #1405).
/** The file the fake Claude's first commit writes in every card's folder. */
const SHARED_FILE = "fake-1.txt";
const tileOf = (c: Context, title: string) =>
  c.page.locator(`li[aria-label="${c.t("kanban.card", { title })}"]`);

/** Makes and starts a card of the scenario's own project, and waits until its run is over. */
async function startNumberedCard(c: Context, n: number, description: string): Promise<string> {
  await openOwnBoard(c);
  return startCardHere(c, n, description);
}

/** Makes and starts a card on the board that is open, and waits until its run is over. */
async function startCardHere(c: Context, n: number, description: string): Promise<string> {
  const title = unique(c, `bdd card ${n}`);
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
  await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
  if (description) {
    await c.page.getByLabel(c.t("kanban.descriptionLabel"), { exact: true }).fill(description);
  }
  await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
  await tileOf(c, title).locator("[data-card-open]").click({ timeout: WAIT });
  await c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
  // Its run is over (changes to review, or the PR to open) before the next card starts.
  await startedLead(c).waitFor({ timeout: SESSION_WAIT });
  return title;
}

step(When, "I start two cards of my own on that project that each commit a file", async (c) => {
  // The fake Claude commits a file when the description says [commit]: the same name in each card.
  const titles = [
    await startNumberedCard(c, 1, "[commit]"),
    await startNumberedCard(c, 2, "[commit]"),
  ];
  mine(c).cards = titles;
  mine(c).card = titles[0] ?? "";
});

const badgeOf = (c: Context, other: string) =>
  dictionary(c).conflictRadar.badgeOne.replace("{title}", other);

step(Then, "each card on the board says it may conflict with the other", async (c) => {
  const [first = "", second = ""] = mine(c).cards ?? [];
  await openOwnBoard(c);
  await tileOf(c, first)
    .getByText(badgeOf(c, second), { exact: true })
    .waitFor({ timeout: SESSION_WAIT });
  await tileOf(c, second)
    .getByText(badgeOf(c, first), { exact: true })
    .waitFor({ timeout: SESSION_WAIT });
});

step(Then, "the first card lists the other card and the file the two share", async (c) => {
  const [first = "", second = ""] = mine(c).cards ?? [];
  await tileOf(c, first).locator("[data-card-open]").click({ timeout: WAIT });
  const section = c.page.getByRole("region", {
    name: dictionary(c).conflictRadar.title,
    exact: true,
  });
  await section.getByText(second, { exact: true }).waitFor({ timeout: WAIT });
  await section.getByText(SHARED_FILE, { exact: true }).waitFor({ timeout: WAIT });
});

step(When, "I open the pull request of the first card", async (c) => {
  const [first = ""] = mine(c).cards ?? [];
  await openOwnBoard(c);
  await tileOf(c, first).locator("[data-card-open]").click({ timeout: WAIT });
  await c.page
    .getByRole("button", { name: c.t("cardUi.openPr"), exact: true })
    .click({ timeout: SESSION_WAIT });
  // The PR text is shown first: the person opens the PR with it.
  await c.page
    .getByRole("dialog")
    .getByRole("button", { name: c.t("watchUi.confirm"), exact: true })
    .click({ timeout: WAIT });
});

step(When, "I ask to merge the first card's pull request", async (c) => {
  await mergeButton(c).click({ timeout: SESSION_WAIT });
});

step(Then, "the confirm says the other card changes the same files", async (c) => {
  const [, second = ""] = mine(c).cards ?? [];
  const line = dictionary(c).conflictRadar.mergeLine.replace("{titles}", second);
  await c.page.getByRole("alertdialog").getByText(line, { exact: true }).waitFor({ timeout: WAIT });
});

// Start a card on another host when its own host would make it wait (issue #1422).
const BETA = "demo-beta";

step(Given, "a git project of my own with a remote is added to host {string}", async (c) =>
  addOwnProject(c, {}, { origin: true }),
);

step(Given, "the same project is added to host {string}", async (c, host = "") => {
  // A clone has the same origin, so the two hosts hold the same repository under one project key.
  const name = mine(c).project ?? "";
  const folder = join(dirname(c.ids.teleportRepo), name);
  execFileSync("git", ["clone", "-q", mine(c).origin ?? "", folder], { stdio: "ignore" });
  await addFolderToHost(c, `demo-${host}`, folder);
});

/** The address of one demo host, as the app saved it. */
async function hostAddress(c: Context, id: string): Promise<string> {
  if (!c.page.url().startsWith(c.url)) await c.page.goto(c.url);
  const hosts = (await c.page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
    HOSTS_KEY,
  )) as Array<{ id: string; url: string }>;
  const url = hosts.find((host) => host.id === id)?.url;
  if (!url) throw new Error(`the demo has no host ${id}`);
  return url;
}

/**
 * Counts the project lists host beta is asked and has answered, and can refuse a start. The refusal
 * is answered in the page, as the host would; everything else goes to the real host.
 */
async function tapBeta(c: Context, refuseStart: boolean) {
  const address = await hostAddress(c, BETA);
  await c.page.addInitScript(
    ({ address, refuse }) => {
      const tap = window as unknown as { listsAsked: number; listsAnswered: number };
      tap.listsAsked = 0;
      tap.listsAnswered = 0;
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (this.url === address && typeof data === "string") {
          const frame = JSON.parse(data) as { id: string };
          if (data.includes('"project.list"')) {
            tap.listsAsked += 1;
            const listen = (event: MessageEvent) => {
              try {
                if ((JSON.parse(String(event.data)) as { id?: string }).id !== frame.id) return;
              } catch {
                return;
              }
              tap.listsAnswered += 1;
              this.removeEventListener("message", listen);
            };
            this.addEventListener("message", listen);
          }
          if (refuse && data.includes('"card.start"')) {
            const nack = {
              type: "ack",
              id: frame.id,
              ok: false,
              error: { code: "internal", message: "refused" },
            };
            setTimeout(
              () => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(nack) })),
              0,
            );
            return;
          }
        }
        send.call(this, data);
      };
    },
    { address, refuse: refuseStart },
  );
}

step(Given, "the app notes what host beta answers about its projects", async (c) =>
  tapBeta(c, false),
);

step(Given, "host beta refuses to start the cards it is handed", async (c) => tapBeta(c, true));

const listsAsked = (c: Context) =>
  c.page.evaluate(() => (window as unknown as { listsAsked?: number }).listsAsked ?? 0);

step(When, "I select a card of my own on that project and ask to start it", async (c) => {
  const title = unique(c, "bdd card");
  mine(c).card = title;
  await openOwnBoard(c);
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
  await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
  await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
  await tile(c).waitFor({ timeout: WAIT });
  mine(c).listsBefore = await listsAsked(c);
  // Ctrl-click selects the card without opening it.
  await tile(c).click({ modifiers: ["Control"], timeout: WAIT });
  await c.page
    .getByRole("group", { name: c.t("board.selection"), exact: true })
    .getByRole("button", { name: c.t("board.startSelected", { n: "1" }), exact: true })
    .click({ timeout: WAIT });
  await c.page.getByRole("alertdialog").waitFor({ timeout: WAIT });
});

const startOnButton = (c: Context, host: string) =>
  c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("board.startOn", { host }), exact: true });

step(Then, "the confirm offers to start it on host {string}", async (c, host = "") => {
  await startOnButton(c, host).waitFor({ timeout: WAIT });
});

step(Then, "the confirm offers no other host to start it on", async (c) => {
  // Absence proves nothing until the host has answered: wait for its answer to the question the
  // confirm asked when it opened, and for the page to draw it.
  const before = mine(c).listsBefore ?? 0;
  await waitFor(
    () =>
      c.page.evaluate((from) => {
        const tap = window as unknown as { listsAsked: number; listsAnswered: number };
        return tap.listsAsked > from && tap.listsAnswered === tap.listsAsked;
      }, before),
    "host beta answered the confirm's question",
  );
  await c.page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const confirm = c.page
    .getByRole("alertdialog")
    .getByRole("button", { name: c.t("board.startSelected", { n: "1" }), exact: true });
  await confirm.waitFor({ timeout: WAIT });
  if ((await startOnButton(c, "beta").count()) > 0) throw new Error("host beta is offered");
  for (const key of ["startOnHint", "startOnHintOne"] as const) {
    const hint = c.page.getByRole("alertdialog").getByText(pattern(dictionary(c).board[key]));
    if ((await hint.count()) > 0) throw new Error("the confirm says another host has the places");
  }
});

step(When, "I choose to start it on host {string}", async (c, host = "") => {
  await startOnButton(c, host).click({ timeout: WAIT });
});

step(Then, "the board says the card started on host {string}", async (c, host = "") => {
  await c.page
    .getByRole("status")
    .filter({ hasText: c.t("board.elsewhereDoneOne", { host }) })
    .waitFor({ timeout: SESSION_WAIT });
});

step(Then, "the board says the card did not start", async (c) => {
  const said = dictionary(c).board.startFailedOne.replace("{names}", "");
  await c.page
    .getByRole("status")
    .filter({ hasText: mine(c).card ?? "" })
    .filter({ hasText: said })
    .waitFor({ timeout: SESSION_WAIT });
});

step(Then, "the card says it started on host {string}", async (c, host = "") => {
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  const note = pattern(dictionary(c).board.startedElsewhere.replace("{host}", host));
  await c.page.getByText(note).first().waitFor({ timeout: WAIT });
});

step(Then, "the card does not say it started on any host", async (c) => {
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  await c.page
    .getByRole("button", { name: c.t("cardUi.start"), exact: true })
    .waitFor({ timeout: WAIT });
  const note = pattern(dictionary(c).board.startedElsewhere.replace("{host}", "beta"));
  if ((await c.page.getByText(note).count()) > 0) throw new Error("the card was marked");
});

/** The board of the scenario's project on host beta. */
async function openBetaBoard(c: Context) {
  await open(c, { name: "projects", host: BETA });
  await c.page
    .getByRole("button", { name: c.t("projectsUi.openBoard", { name: mine(c).project ?? "" }) })
    .click({ timeout: WAIT });
}

step(Then, "host beta runs a copy of the card", async (c) => {
  await openBetaBoard(c);
  await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
  await startedLead(c).waitFor({ timeout: SESSION_WAIT });
});

step(Then, "host beta has no copy of the card", async (c) => {
  await openBetaBoard(c);
  // The empty-board message is drawn only once the board is loaded and holds no card: a copy left
  // on beta would keep it from ever appearing.
  await c.page.getByText(c.t("states.emptyCards"), { exact: true }).waitFor({ timeout: WAIT });
  if ((await tile(c).count()) > 0) throw new Error("host beta holds a copy of the card");
});

// Update N from the base: the selection's cards are rebased one at a time, and the summary names each outcome (issue #1406).
/** The worktree of one card of the scenario, found by the branch its title gives it. */
const worktreeOf = (c: Context, title: string) => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return join(projectFolder(c), ".flightdeck", "worktrees", slug);
};

/** Whether the project's base branch is part of the card's history. */
const hasBase = (c: Context, title: string) => {
  try {
    gitIn(worktreeOf(c, title), "merge-base", "--is-ancestor", "main", "HEAD");
    return true;
  } catch {
    return false;
  }
};

step(
  When,
  "I start two cards of my own on that project, the first committing a file",
  async (c) => {
    const first = await startNumberedCard(c, 1, "[commit]");
    const second = await startNumberedCard(c, 2, "");
    mine(c).cards = [first, second];
  },
);

step(When, "the base branch gets a commit that adds the same file with other text", async (c) => {
  const folder = projectFolder(c);
  writeFileSync(join(folder, SHARED_FILE), "from the base\n");
  gitIn(folder, "add", SHARED_FILE);
  gitIn(folder, "commit", "-q", "-m", "the base moves on");
});

step(When, "I start a third card of my own on that project", async (c) => {
  const third = await startNumberedCard(c, 3, "");
  mine(c).cards = [...(mine(c).cards ?? []), third];
});

step(When, "I select the three cards and update them from the base", async (c) => {
  const [first = "", ...others] = mine(c).cards ?? [];
  mine(c).head = gitIn(worktreeOf(c, first), "rev-parse", "HEAD").trim();
  await openOwnBoard(c);
  for (const title of [first, ...others]) {
    await tileOf(c, title).click({ modifiers: ["Control"], timeout: WAIT });
  }
  await c.page
    .getByRole("group", { name: c.t("board.selection"), exact: true })
    .getByRole("button", { name: c.t("board.updateSelected", { n: "3" }), exact: true })
    .click({ timeout: WAIT });
});

step(
  Then,
  "the summary names the card updated, the one already current and the one in conflict",
  async (c) => {
    const [first = "", second = "", third = ""] = mine(c).cards ?? [];
    const board = dictionary(c).board;
    const summary = c.page.getByRole("status");
    const lead = (template: string) => template.split("{names}")[0] ?? "";
    await summary
      .filter({ hasText: board.updatedNames.replace("{names}", second) })
      .filter({ hasText: board.currentNames.replace("{names}", third) })
      .filter({ hasText: lead(board.conflictedNames) + first })
      .waitFor({ timeout: SESSION_WAIT });
  },
);

step(Then, "the card in conflict is left as it was", async (c) => {
  const [first = ""] = mine(c).cards ?? [];
  const worktree = worktreeOf(c, first);
  // Not rebased, not half way: the same commit, a clean tree, no rebase in progress.
  if (gitIn(worktree, "rev-parse", "HEAD").trim() !== mine(c).head)
    throw new Error("its branch moved");
  if (gitIn(worktree, "status", "--porcelain").trim() !== "")
    throw new Error("its tree is not clean");
  if (gitIn(worktree, "status").includes("rebase")) throw new Error("a rebase is left open");
  if (hasBase(c, first)) throw new Error("it already holds the base commit");
});

step(Then, "the updated card holds the base commit", async (c) => {
  const [, second = ""] = mine(c).cards ?? [];
  if (!hasBase(c, second)) throw new Error("the updated card does not hold the base commit");
});

// Keep going until the checks pass: the project's check runs when a turn ends, and its output goes back as a round (issue #1361).
/** What the check does, as a script in the project: the check itself is `sh ./check.sh`. */
const CHECK_COMMAND = "sh ./check.sh";
const CHECK_SCRIPTS = {
  // Fails once and prints the fake Claude's marker for a file: the round carries it, so the file is written.
  fixed: 'test -e ok.txt || { echo "[result:ok.txt]"; exit 1; }\n',
  red: 'echo "still red"\nexit 1\n',
  // Writes its own process id, so a scenario can tell when this very run is gone.
  slow: "echo $$ > .check-pid\nsleep 45\nexit 1\n",
};
/** The first words of a round message: it is data for the session, never UI text. */
const ROUND = "Round";

step(
  Given,
  "a git project of my own with a check that passes once the session has written a file is added to host {string}",
  async (c) => addOwnProject(c, { "check.sh": CHECK_SCRIPTS.fixed }),
);

step(
  Given,
  "a git project of my own with a check that always fails is added to host {string}",
  async (c) => addOwnProject(c, { "check.sh": CHECK_SCRIPTS.red }),
);

step(
  Given,
  "a git project of my own with a check that takes a long time is added to host {string}",
  async (c) => addOwnProject(c, { "check.sh": CHECK_SCRIPTS.slow }),
);

step(Given, "the project's check is its script", async (c) => {
  await open(c, { name: "settings" });
  const section = c.page.getByRole("region", {
    name: c.t("watchSettingsUi.title", { host: "alfa" }),
    exact: true,
  });
  const block = section
    .getByRole("heading", { name: mine(c).project ?? "", exact: true })
    .locator("xpath=..");
  await block
    .getByLabel(c.t("watchSettingsUi.checks"), { exact: true })
    .fill(CHECK_COMMAND, { timeout: WAIT });
  await block.getByRole("button", { name: c.t("watchSettingsUi.save"), exact: true }).click();
  await c.page.getByText(c.t("watchSettingsUi.saved"), { exact: true }).waitFor({ timeout: WAIT });
});

const loopSwitch = (c: Context) =>
  c.page.getByRole("switch", { name: c.t("checkLoopUi.switch"), exact: true });

step(
  When,
  "I turn on keep going until the checks pass on a new card of that project and start it",
  async (c) => {
    const title = unique(c, "bdd card");
    mine(c).card = title;
    await openOwnBoard(c);
    await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
    await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
    await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
    await tile(c).locator("[data-card-open]").click({ timeout: WAIT });
    await loopSwitch(c).click({ timeout: WAIT });
    // The card is not in a mode that runs without asking, so the host asks first.
    await c.page
      .getByRole("alertdialog")
      .getByText(c.t("checkLoopUi.confirm"), { exact: true })
      .waitFor({ timeout: WAIT });
    await c.page
      .getByRole("alertdialog")
      .getByRole("button", { name: c.t("checkLoopUi.confirmAction"), exact: true })
      .click();
    await waitFor(
      async () => (await loopSwitch(c).getAttribute("aria-checked")) === "true",
      "the switch is on",
    );
    await c.page.getByRole("button", { name: c.t("cardUi.start"), exact: true }).click();
  },
);

/** One line of the loop's panel, by the dictionary text it comes from. */
const loopLine = (c: Context, text: string) => c.page.getByText(text, { exact: true });

step(Then, "the card says the checks passed", async (c) => {
  await loopLine(c, dictionary(c).checkLoopUi.ended.passed).waitFor({ timeout: SESSION_WAIT });
});

step(
  Then,
  "the card says the checks still failed after {string} rounds",
  async (c, rounds = "") => {
    const text = dictionary(c)
      .checkLoopUi.ended.rounds_spent.replace("{max}", rounds)
      .replace("{command}", CHECK_COMMAND);
    await loopLine(c, text).waitFor({ timeout: SESSION_WAIT });
  },
);

step(When, "I send the card a message of my own while its checks run", async (c) => {
  await loopLine(c, dictionary(c).checkLoopUi.checking).waitFor({ timeout: SESSION_WAIT });
  const file = join(worktreeOf(c, mine(c).card ?? ""), ".check-pid");
  await waitFor(
    async () => existsSync(file) && readFileSync(file, "utf8").trim() !== "",
    "the check started",
  );
  mine(c).checkPid = Number(readFileSync(file, "utf8").trim());
  // `[tool]` makes the fake Claude ask permission and wait: the person's turn stays open while the
  // scenario looks at the loop, so what it sees is the loop's answer to the message, not the turn's end.
  const box = c.page.getByLabel(c.t("session.message"), { exact: true });
  await box.fill(`[tool] ${unique(c, "my own message")}`);
  await box.press("Enter");
});

step(Then, "the card says the loop stepped aside", async (c) => {
  await loopLine(c, dictionary(c).checkLoopUi.ended.person_turn).waitFor({
    timeout: SESSION_WAIT,
  });
});

/** How many rounds of the loop the conversation holds: the messages that start with the round text. */
step(Then, "the session was sent {string} rounds of the loop", async (c, count = "") => {
  const rounds = c.page.getByText(new RegExp(`^${ROUND} \\d+ of \\d+:`));
  await waitFor(
    async () => (await rounds.count()) === Number(count),
    `${count} rounds in the conversation`,
  );
});

step(Then, "the board shows the card in the column {string}", async (c, column = "") => {
  await openOwnBoard(c);
  await c.page
    .getByRole("region", { name: columnName(c, column), exact: true })
    .locator(`li[aria-label="${c.t("kanban.card", { title: mine(c).card ?? "" })}"]`)
    .waitFor({ timeout: SESSION_WAIT });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

step(Then, "the check the message interrupted is gone", async (c) => {
  const pid = mine(c).checkPid ?? 0;
  if (pid <= 0) throw new Error("the check's process id was not read");
  await waitFor(async () => !alive(pid), "the interrupted check has ended");
});

// Second opinion: a second Claude call reads the card's diff before Open PR (issues #1439, #1446, #1525).
/** What the demo's canned review says (daemon fake runtime): not UI text, so the same in both languages. */
const CANNED_SUMMARY = "Two findings on the changes, one general note.";
const secondOpinion = (c: Context) =>
  c.page.getByRole("region", { name: c.t("secondOpinion.title"), exact: true });

step(Given, "the app holds the second-opinion request until I let it go", async (c) => {
  await c.page.addInitScript(() => {
    const tap = window as unknown as { releaseReview?: () => void };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.includes('"card.review"')) {
        tap.releaseReview = () => send.call(this, data);
        return;
      }
      send.call(this, data);
    };
  });
});

/** The card's Changes view, where the second opinion and the reviewer drafts are. */
async function openChanges(c: Context) {
  const diff = c.page.getByRole("button", { name: c.t("cardUi.diff"), exact: true });
  await diff.click({ timeout: WAIT });
  await waitFor(async () => (await diff.getAttribute("aria-pressed")) === "true", "Changes open");
}

step(When, "I finish a card of my own that changed two lines", async (c) => {
  // The fake Claude writes the description into a file and commits it: two lines, two added lines.
  mine(c).card = await startNumberedCard(c, 1, "[commit]\nsecond line");
  await openChanges(c);
});

step(When, "I finish a card of my own that changed nothing", async (c) => {
  mine(c).card = await startNumberedCard(c, 1, "");
  await openChanges(c);
});

step(When, "I ask for a second opinion", async (c) => {
  await secondOpinion(c)
    .getByRole("button", { name: c.t("secondOpinion.ask"), exact: true })
    .click({ timeout: WAIT });
});

step(Then, "the second opinion says it is reading and cannot be asked again", async (c) => {
  await secondOpinion(c).getByText(c.t("secondOpinion.reading"), { exact: true }).waitFor({
    timeout: WAIT,
  });
  const ask = secondOpinion(c).getByRole("button", { name: c.t("secondOpinion.ask"), exact: true });
  if (!(await ask.isDisabled())) throw new Error("the button can be pressed while the review runs");
});

step(When, "I let the held request go", async (c) => {
  await c.page.evaluate(() => (window as unknown as { releaseReview: () => void }).releaseReview());
});

step(Then, "the second opinion gives its summary", async (c) => {
  await secondOpinion(c).getByText(CANNED_SUMMARY, { exact: true }).waitFor({ timeout: WAIT });
});

step(Then, "it says {string} findings are drafts below", async (c, count = "") => {
  await secondOpinion(c)
    .getByText(c.t("secondOpinion.drafts", { n: count }), { exact: true })
    .waitFor({ timeout: WAIT });
});

/** The canned review's third finding, on a line the diff does not add. */
const LOOSE_BODY = "Consider a note in the changelog.";

step(Then, "it lists {string} finding that is on no changed line", async (c, count = "") => {
  const box = secondOpinion(c);
  await box
    .getByRole("heading", { name: c.t("secondOpinion.loose", { n: count }), exact: true })
    .waitFor({ timeout: WAIT });
  await box.getByText(LOOSE_BODY, { exact: true }).waitFor({ timeout: WAIT });
});

step(Then, "the changes hold {string} drafts from the reviewer", async (c, count = "") => {
  const list = c.page.getByRole("list", { name: c.t("changes.list"), exact: true });
  await waitFor(
    async () =>
      (await list.getByText(c.t("secondOpinion.reviewer"), { exact: true }).count()) ===
      Number(count),
    `${count} drafts from the reviewer`,
  );
});

step(When, "I ask to open the pull request", async (c) => {
  await c.page
    .getByRole("button", { name: c.t("cardUi.openPr"), exact: true })
    .click({ timeout: WAIT });
});

step(
  Then,
  "the dialog says {string} reviewer findings are not addressed, {string} of them high",
  async (c, open = "", high = "") => {
    await c.page
      .getByRole("dialog")
      .getByText(c.t("secondOpinion.notAddressed", { n: open, high }), { exact: true })
      .waitFor({ timeout: WAIT });
  },
);

step(Then, "the second opinion is off and says the card has no changes to review", async (c) => {
  const box = secondOpinion(c);
  await box.getByText(c.t("secondOpinion.noChanges"), { exact: true }).waitFor({ timeout: WAIT });
  const ask = box.getByRole("button", { name: c.t("secondOpinion.ask"), exact: true });
  if (!(await ask.isDisabled())) throw new Error("the button can be pressed with nothing to read");
});

step(When, "I press Go to the drafts", async (c) => {
  await secondOpinion(c)
    .getByRole("button", { name: c.t("secondOpinion.goToDrafts"), exact: true })
    .click({ timeout: WAIT });
});

step(Then, "the focus is on the reviewer's first draft", async (c) => {
  await waitFor(
    () =>
      c.page.evaluate(() => {
        const first = document.querySelector('[data-reviewer="draft"]');
        return first !== null && document.activeElement === first;
      }),
    "the focus on the first reviewer draft",
  );
});

step(Then, "the focus is on the button that asks for a second opinion", async (c) => {
  const ask = c.t("secondOpinion.ask");
  await waitFor(
    () =>
      c.page.evaluate(
        (name) =>
          document.activeElement?.tagName === "BUTTON" &&
          (document.activeElement.textContent ?? "").includes(name),
        ask,
      ),
    "the focus on the button that asks for a second opinion",
  );
});

// The first hour: a first start with no host, the pairing link of a real host, the first project, card and PR (issue #1562).
step(Given, "the app starts with no host", async (c) => {
  // `hosts=none` is the first-run screen's address (#1052); the page stays on it, because a reload
  // would lose the token the pairing keeps in memory.
  await c.page.goto(`${c.url}?hosts=none&lang=${c.lang}&theme=light&reconnect=fast`);
  await c.page.getByRole("heading", { name: c.t("welcome.title"), exact: true }).waitFor({
    timeout: WAIT,
  });
});

step(Then, "the screen asks to connect the first host", async (c) => {
  await c.page.getByRole("heading", { name: c.t("welcome.title"), exact: true }).waitFor({
    timeout: WAIT,
  });
  // No host is listed yet: the sidebar has no host dot.
  const dots = await c.page.getByRole("img", { name: /^(alfa|beta|gama): / }).count();
  if (dots !== 0) throw new Error(`the first start lists ${dots} hosts`);
});

step(
  When,
  "I paste the pairing link of the first demo host named {string}",
  async (c, name = "") => {
    const link = formatPairingLink({ ...c.ids.alfaPairing, name });
    await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).fill(link);
  },
);

step(
  When,
  "I type the pairing link of the first demo host named {string}",
  async (c, name = "") => {
    const link = formatPairingLink({ ...c.ids.alfaPairing, name });
    await c.page.getByLabel(c.t("hostForm.link"), { exact: true }).pressSequentially(link);
  },
);

step(When, "I press Test and add", async (c) =>
  c.page.getByRole("button", { name: c.t("hostForm.submit"), exact: true }).click(),
);

/** What has the focus, for a message: its tag and its text. */
const focusSummary = (c: Context) =>
  c.page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "nothing";
    if (el === document.body) return "the page body";
    return `<${el.tagName.toLowerCase()}> ${(el.textContent ?? "").trim().slice(0, 40)}`;
  });

// #1546, #1580: a step that opens a page leaves the focus on the new page's heading, in a real browser.
step(Then, "the focus is on the heading of the page the step opened", async (c) => {
  try {
    await waitFor(
      () =>
        c.page.evaluate(
          () => document.activeElement?.matches("main [data-slot=page-title]") === true,
        ),
      "the focus on the page's heading",
    );
  } catch (error) {
    throw new Error(`${(error as Error).message}; the focus is on ${await focusSummary(c)}`);
  }
});

step(Then, "the host {string} shows online in the sidebar", async (c, name = "") =>
  c.page
    .getByRole("img", {
      name: c.t("sidebar.hostState", { host: name, state: c.t("hosts.status.online") }),
      exact: true,
    })
    .waitFor({ timeout: SESSION_WAIT }),
);
step(When, "I add a git repository of my own as my first project from the host page", async (c) =>
  addFirstProject(c, makeOwnRepo(c)),
);

step(
  When,
  "I add a git repository of my own with a remote as my first project from the host page",
  async (c) => addFirstProject(c, makeOwnRepo(c, {}, { origin: true })),
);

/** The first project, added from the paired host's page without leaving the page. */
async function addFirstProject(c: Context, folder: string) {
  await c.page
    .getByRole("button", { name: c.t("hostHome.seeAllProjects"), exact: true })
    .or(c.page.getByRole("link", { name: c.t("hostHome.seeAllProjects"), exact: true }))
    .click({ timeout: WAIT });
  await c.page
    .getByRole("button", { name: c.t("projectsOverview.newProject"), exact: true })
    .click({ timeout: WAIT });
  const dialog = c.page.getByRole("dialog", { name: c.t("addProject.title"), exact: true });
  await dialog.getByLabel(c.t("addProject.folder"), { exact: true }).fill(folder);
  await dialog.getByRole("button", { name: c.t("addProject.add"), exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: WAIT });
}

step(When, "I open the board of my first project from its page", async (c) =>
  c.page
    .getByRole("main")
    .getByRole("button", { name: c.t("sidebar.board"), exact: true })
    .click({ timeout: WAIT }),
);

step(When, "I make and start my first card, which commits a file", async (c) => {
  mine(c).card = await startCardHere(c, 1, "[commit]");
});

step(When, "I open the changes of my first card", async (c) => {
  await c.page
    .getByRole("button", { name: c.t("cardUi.reviewChanges"), exact: true })
    .click({ timeout: WAIT });
});

/** The host a first start names when it pairs the demo's first host. */
const FIRST_HOST = "orange pi";

step(Then, "Needs you lists my first card as finished", async (c) => {
  await c.page
    .getByRole("heading", { name: c.t("needsYou.finished"), exact: true })
    .waitFor({ timeout: SESSION_WAIT });
  await finishedRow(c, mine(c).card ?? "", FIRST_HOST).waitFor({ timeout: SESSION_WAIT });
});

step(When, "I choose GitHub as the PR host of my first project in its settings", async (c) => {
  const name = mine(c).project ?? "";
  await c.page
    .getByRole("button", { name: c.t("projectsUi.edit", { name }), exact: true })
    .click({ timeout: WAIT });
  await c.page.getByLabel(c.t("projectsUi.prProvider"), { exact: true }).selectOption("github");
  await c.page.getByRole("button", { name: c.t("projectsUi.save"), exact: true }).click();
  await c.page
    .getByText(c.t("projectsUi.editTitle"), { exact: true })
    .waitFor({ state: "detached", timeout: WAIT });
});

step(When, "I open the settings of my first project from its page", async (c) =>
  c.page
    .getByRole("main")
    .getByRole("button", { name: c.t("sidebar.settings"), exact: true })
    .click({ timeout: WAIT }),
);

step(When, "I open the board of my first project from the projects list", async (c) =>
  c.page
    .getByRole("button", { name: c.t("projectsUi.openBoard", { name: mine(c).project ?? "" }) })
    .click({ timeout: WAIT }),
);

const prDialog = (c: Context) =>
  c.page.getByRole("dialog", { name: c.t("watchUi.descriptionTitle"), exact: true });

step(
  Then,
  "the dialog offers the PR's title and description to read before it opens",
  async (c) => {
    const dialog = prDialog(c);
    await dialog.waitFor({ timeout: WAIT });
    for (const field of [c.t("watchUi.prTitle"), c.t("watchUi.descriptionTitle")]) {
      await dialog.getByLabel(field, { exact: true }).waitFor({ timeout: WAIT });
    }
  },
);

step(When, "I open the PR with that text", async (c) =>
  prDialog(c)
    .getByRole("button", { name: c.t("watchUi.confirm"), exact: true })
    .click(),
);

step(Then, "the card says its PR is open and offers Merge PR", async (c) => {
  await c.page
    .getByText(c.t("pr.open"), { exact: true })
    .first()
    .waitFor({ timeout: SESSION_WAIT });
  await mergeButton(c).waitFor({ timeout: WAIT });
});

step(Then, "the first tab and the breadcrumb say to connect a host", async (c) => {
  await c.page
    .getByRole("tab", { name: c.t("welcome.crumb"), exact: true, selected: true })
    .waitFor({ timeout: WAIT });
  await c.page
    .getByRole("navigation", { name: c.t("shell.breadcrumb"), exact: true })
    .getByText(c.t("welcome.crumb"), { exact: true })
    .waitFor({ timeout: WAIT });
});

step(When, "I leave the pairing link field", async (c) =>
  c.page.getByLabel(c.t("hostForm.link"), { exact: true }).press("Tab"),
);

step(Then, "the pairing link field shows dots in place of the token", async (c) => {
  const field = c.page.getByLabel(c.t("hostForm.link"), { exact: true });
  await waitFor(async () => (await field.inputValue()).includes(TOKEN_MASK), "the token is masked");
  const shown = await field.inputValue();
  if (shown.includes(c.ids.alfaPairing.token)) throw new Error("the link field shows the token");
});

step(Then, "the card says no PR can be opened without a PR provider", async (c) => {
  await c.page.getByText(c.t("cardUi.noRemote"), { exact: true }).waitFor({ timeout: WAIT });
});

step(Then, "the card names the branch to push by hand", async (c) => {
  const branch = gitIn(
    worktreeOf(c, mine(c).card ?? ""),
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ).trim();
  await c.page
    .getByText(c.t("cardUi.noRemoteBranch", { branch }), { exact: true })
    .waitFor({ timeout: WAIT });
});

step(Then, "Review changes still leads and Open PR is not offered", async (c) => {
  await c.page
    .getByRole("button", { name: c.t("cardUi.reviewChanges"), exact: true })
    .waitFor({ timeout: WAIT });
  const open = await c.page
    .getByRole("button", { name: c.t("cardUi.openPr"), exact: true })
    .count();
  if (open !== 0) throw new Error("Open PR is offered on a project with no PR provider");
});

// Round 14 (#1546): a step that removes the control that had the focus must not leave it on the page body.
step(When, "I create my first card without starting it", async (c) => {
  const title = unique(c, "bdd card 1");
  mine(c).card = title;
  await c.page.getByRole("button", { name: c.t("kanban.newCard"), exact: true }).click();
  await c.page.getByLabel(c.t("kanban.titleLabel"), { exact: true }).fill(title);
  await c.page.getByRole("button", { name: c.t("kanban.create"), exact: true }).click();
});

step(Then, "the focus is on the card I made", async (c) => {
  const tile = tileOf(c, mine(c).card ?? "");
  await waitFor(
    () => tile.evaluate((el) => el.contains(document.activeElement)),
    "the focus is on the new card",
  );
});
