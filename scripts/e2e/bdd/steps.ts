/** The steps of the BDD pilot: each is written once per language, and the UI text comes from the dictionaries. */
import { type Context, open, WAIT, waitFor } from "../journeys.ts";
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
/** A session needs the host to start it: on a loaded machine that takes far longer than a click. */
const SESSION_WAIT = 60_000;
const request = (c: Context, session: string) =>
  c.page.locator("main ul li button", { hasText: session });

async function createSession(c: Context, prompt: string, name?: string) {
  await open(c, { name: "new-session", host: ALFA });
  if (name) await c.page.getByLabel(c.t("newSession.name"), { exact: false }).fill(name);
  await c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt);
  await c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click();
}

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
  async (c, prompt = "") =>
    c.page.getByLabel(c.t("newSession.prompt"), { exact: true }).fill(prompt),
);

both(When, { pt: "crio a sessão", en: "I create the session" }, async (c) =>
  c.page.getByRole("button", { name: c.t("newSession.create"), exact: true }).click(),
);

both(
  Then,
  {
    pt: "a sessão abre mostrando o meu prompt {string}",
    en: "the session opens showing my prompt {string}",
  },
  async (c, prompt = "") => c.page.getByText(prompt).first().waitFor({ timeout: SESSION_WAIT }),
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
  async (c, session = "") => request(c, session).first().click({ timeout: SESSION_WAIT }),
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
