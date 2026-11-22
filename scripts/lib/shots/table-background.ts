/** Part of the print table (scripts/demo-shots.ts), in print order: Claude Code's background sessions (#4173). */
import type { Page } from "playwright-core";
import { translator } from "../../../apps/desktop/src/i18n/index.ts";
import type { Key } from "../../../apps/desktop/src/i18n/types.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

/** A demo session the app already shows as an external one: the panel is on its screen. */
const SCREEN = "ext-rodando";
/** A card of the demo that nothing runs: its menu offers the start. */
const CARD = "Definir o esquema do carrinho";
const CWD = "/srv/projects/flightdeck-web";

const EN = translator("en");
const PT = translator("pt-BR");
const exactly = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The text of a dictionary key in either language, exactly (a print runs in both). */
const text = (key: Key, vars?: Record<string, string>) =>
  new RegExp(`^(${exactly(EN(key, vars))}|${exactly(PT(key, vars))})$`);

type State = "working" | "blocked" | "done" | "failed" | "stopped";

/** What `bg.list` answers: the host's `claude agents` listing, which the demo's hosts cannot be left holding. */
function session(state: State, claudeSessionId: string | null, name: string, at = 0) {
  return {
    id: `bg-${state}-${at}`,
    name,
    cwd: CWD,
    state,
    status: state === "working" ? "busy" : state === "blocked" ? "waiting" : null,
    waitingFor: state === "blocked" ? "Bash: bun test" : null,
    pid: state === "working" || state === "blocked" ? 4200 + at : null,
    claudeSessionId,
    startedAt: 1_760_000_000_000,
    costUsd: state === "working" ? null : 0.42,
  };
}

/** The answer of `bg.list` with the given sessions (the page answers it, so no host is changed). */
const list = (...sessions: ReturnType<typeof session>[]): WireRule => ({
  command: "bg.list",
  reply: { supported: true, sessions },
});

/** One session of the screen's own, in `state`. */
const own = (state: State): WireRule[] => [list(session(state, SCREEN, "Dev server"))];

const external = { name: "external" as const, host: ALFA, claudeSessionId: SCREEN };
const field = (page: Page) => page.getByRole("textbox", { name: text("bg.message") });
const send = (page: Page) => page.getByRole("button", { name: text("bg.send") });

/** The box with a text in it, so Send is on. */
async function typeMessage(page: Page): Promise<void> {
  await field(page).fill("Keep going, then run the tests");
}

/** The text sent: the host says it took it (the page answers, as no host lists this session). */
async function sendMessage(page: Page): Promise<void> {
  await typeMessage(page);
  await send(page).click();
  await page.getByText(text("bg.sent")).waitFor();
}

/** The text sent and refused: the host does not list this session, so it says so, and the text stays. */
async function sendRefused(page: Page): Promise<void> {
  await typeMessage(page);
  await send(page).click();
  await page.getByText(text("bg.sendFailed")).waitFor();
}

/** Stop asked and confirmed, and the host refuses it for the same reason. */
async function stopRefused(page: Page): Promise<void> {
  await page.getByRole("button", { name: text("bg.stop") }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: text("bg.stopTitle") })
    .click();
  await page.getByText(text("bg.stopFailed")).waitFor();
}

/** The new-session form with the option ticked; it sits in the folded "More options". */
async function tickBackground(page: Page): Promise<void> {
  await page.getByRole("button", { name: text("newSession.moreOptions") }).click();
  await page.getByRole("checkbox", { name: text("bg.start") }).check();
}

/** A card's menu open, with the item that starts it in the background. */
async function openCardMenu(page: Page): Promise<void> {
  // The tile's own menu has no such item: it is in the run panel of the card's detail.
  await page.getByRole("button", { name: CARD, exact: true }).click();
  const run = page.locator("[data-slot=card-run]");
  await run.getByRole("button", { name: /^(Ações de|Actions for) / }).click();
  await page.getByRole("menuitem", { name: text("bg.startItem") }).waitFor();
}

export function backgroundShots(ids: DemoIds): Shot[] {
  const panel = (name: string, state: State): Shot => ({
    name: `sessao-bg-${name}`,
    route: external,
    wire: own(state),
  });
  return [
    panel("trabalhando", "working"),
    panel("bloqueada", "blocked"),
    panel("concluida", "done"),
    panel("falhou", "failed"),
    panel("parada", "stopped"),
    // The Message field with a text in it (empty, it is on every print above).
    { name: "sessao-bg-mensagem", route: external, wire: own("blocked"), prepare: typeMessage },
    {
      name: "sessao-bg-mensagem-enviada",
      route: external,
      wire: [
        ...own("blocked"),
        // The list comes back with the answer: the same one, so the panel stays on the screen.
        {
          command: "bg.message",
          reply: { supported: true, sessions: [session("blocked", SCREEN, "Dev server")] },
        },
      ],
      prepare: sendMessage,
    },
    {
      name: "sessao-bg-mensagem-recusada",
      route: external,
      wire: own("blocked"),
      prepare: sendRefused,
    },
    {
      name: "sessao-bg-parar-recusado",
      route: external,
      wire: own("working"),
      prepare: stopRefused,
    },
    {
      // Hub rows of sessions that no screen of the app owns: one in each state.
      name: "hub-bg",
      route: { name: "hub" },
      wire: [
        list(
          session("working", null, "Update the changelog", 1),
          session("blocked", null, "Migrate the schema", 2),
          session("done", null, "Review the login flow", 3),
          session("failed", null, "Build the installer", 4),
          session("stopped", null, "Clean the build folder", 5),
        ),
      ],
    },
    {
      name: "nova-sessao-bg",
      route: { name: "new-session", host: ALFA },
      prepare: tickBackground,
    },
    {
      name: "card-menu-bg",
      route: { name: "board", host: ALFA, projectId: ids.project },
      prepare: openCardMenu,
    },
  ];
}
