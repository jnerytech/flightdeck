/** Part of the print table (scripts/demo-shots.ts), in print order: Claude Code's background sessions (#4173). */
import type { Page } from "playwright-core";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA, type Shot } from "./shot.ts";
import type { WireRule } from "./wire.ts";

/** A demo session the app already shows as an external one: the panel is on its screen. */
const SCREEN = "ext-rodando";
const CWD = "/srv/projects/flightdeck-web";

const text = (en: string, pt: string) => new RegExp(`^(${en}|${pt})$`);

type State = "working" | "blocked" | "done" | "failed" | "stopped";

/** What `bg.list` answers: the host's `claude agents` listing, which the demo's hosts cannot be left holding. */
function session(state: State, claudeSessionId: string | null, name: string, at = 0) {
  return {
    id: `bg-${state}-${at}`,
    name,
    cwd: CWD,
    state,
    status: null,
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
const field = (page: Page) => page.getByRole("textbox", { name: text("Message", "Mensagem") });
const send = (page: Page) => page.getByRole("button", { name: text("Send", "Enviar") });

/** The box with a text in it, so Send is on. */
async function typeMessage(page: Page): Promise<void> {
  await field(page).fill("Keep going, then run the tests");
}

/** The text sent: the host says it took it (the page answers, as no host lists this session). */
async function sendMessage(page: Page): Promise<void> {
  await typeMessage(page);
  await send(page).click();
  await page.getByText(text("Message sent.", "Mensagem enviada.")).waitFor();
}

/** The text sent and refused: the host does not list this session, so it says so, and the text stays. */
async function sendRefused(page: Page): Promise<void> {
  await typeMessage(page);
  await send(page).click();
  await page
    .getByText(
      text(
        "The message was not sent. Your text is still in the field.",
        "A mensagem não foi enviada. Seu texto continua no campo.",
      ),
    )
    .waitFor();
}

/** Stop asked and confirmed, and the host refuses it for the same reason. */
async function stopRefused(page: Page): Promise<void> {
  await page.getByRole("button", { name: text("Stop", "Parar") }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: text("Stop session", "Parar a sessão") })
    .click();
  await page
    .getByText(text("Could not stop the session.", "Não foi possível parar a sessão."))
    .waitFor();
}

/** The new-session form with the option ticked; it sits in the folded "More options". */
async function tickBackground(page: Page): Promise<void> {
  await page.getByRole("button", { name: text("More options", "Mais opções") }).click();
  await page
    .getByRole("checkbox", { name: text("Start in the background", "Iniciar em segundo plano") })
    .check();
}

/** A card's menu open, with the item that starts it in the background. */
async function openCardMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Ações de|Actions for) Tela do carrinho$/ }).click();
  await page
    .getByRole("menuitem", {
      name: text("Start in the background, no terminal", "Iniciar em segundo plano, sem terminal"),
    })
    .waitFor();
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
