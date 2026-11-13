import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TeamInfo } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TeamsPage } = await import("../../src/features/teams/page.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const WORDS = {
  en: {
    row: "Team login",
    pause: "Pause login",
    resume: "Resume login",
    close: "Close login",
    closeConfirm: "Close",
    addWorker: "Add a worker to login",
    menu: "Actions for login",
    delete: "Delete team",
    newTeam: "New team",
    removeW1: "Remove w1",
    removeW2: "Remove w2",
    removeConfirm: "Remove",
    paused: "Team login paused",
    resumed: "Team login resumed",
    closed: "Team login closed",
    deleted: "Team login deleted",
    removed: "Worker w1 removed",
    notDone: "Not done: the team has a worker at work",
  },
  "pt-BR": {
    row: "Time login",
    pause: "Pausar login",
    resume: "Retomar login",
    close: "Encerrar login",
    closeConfirm: "Encerrar",
    addWorker: "Adicionar executora a login",
    menu: "Ações de login",
    delete: "Excluir time",
    newTeam: "Novo time",
    removeW1: "Remover w1",
    removeW2: "Remover w2",
    removeConfirm: "Remover",
    paused: "Time login pausado",
    resumed: "Time login retomado",
    closed: "Time login encerrado",
    deleted: "Time login excluído",
    removed: "Executora w1 removida",
    notDone: "Não foi feito: the team has a worker at work",
  },
};

const member = (name: string, role: "coordinator" | "worker") => ({
  name,
  role,
  persona: null,
  model: null,
  cardId: null,
  sessionId: null,
  address: null,
  sessionState: null,
  number: null,
});

/**
 * #2650: Pause, Resume, Close, Remove and Delete changed the team and said nothing, and a confirm
 * dialog gave the focus back to a button that was gone. The host keeps one team; `refuse` makes
 * the next command of that type answer a refusal.
 */
async function openTeam(language: "en" | "pt-BR", refuse: string | null = null) {
  let teams: TeamInfo[] = [
    {
      id: "t1",
      name: "login",
      projectId: "p1",
      goal: "ship it",
      coordinator: "coord",
      checks: [],
      state: "active",
      pausedBy: null,
      instructionsVersion: "1",
      createdAt: "2026-11-13T00:00:00Z",
      members: [member("coord", "coordinator"), member("w1", "worker"), member("w2", "worker")],
    },
  ];
  const change = (type: string, edit: (team: TeamInfo) => void) => (): TeamInfo => {
    if (type === refuse) throw new RequestError("invalid", "the team has a worker at work");
    const team = teams[0] as TeamInfo;
    edit(team);
    return team;
  };
  const host = await fakeHostStore(
    {
      "teams.list": () => ({ teams }),
      "teams.pause": change("teams.pause", (t) => {
        t.state = "paused";
      }),
      "teams.resume": change("teams.resume", (t) => {
        t.state = "active";
      }),
      "teams.close": change("teams.close", (t) => {
        t.state = "closed";
      }),
      "teams.delete": change("teams.delete", () => {
        const gone = teams;
        teams = [];
        return gone;
      }),
      "teams.update": (payload: { removeMember?: string }) =>
        change("teams.update", (t) => {
          if (payload.removeMember) {
            t.members = t.members.filter((m) => m.name !== payload.removeMember);
          }
        })(),
    },
    { hostId: "h1", features: ["teams"], language, fallback: null },
  );
  host.store.i18n.start();
  host.store.projectList.load = async () => null;
  render(
    <TooltipProvider>
      <TeamsPage store={host.store} go={() => {}} />
    </TooltipProvider>,
  );
  const words = WORDS[language];
  await settleMaybe(() => screen.queryByRole("button", { name: words.pause }) !== null, 3000);
  return { words };
}

const button = (name: string) => screen.queryByRole("button", { name });
const click = (name: string) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
/** The confirming button of the open dialog. */
const confirm = (name: string) =>
  act(async () => {
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name }));
  });
const said = (text: string) =>
  screen.queryAllByRole("status").some((el) => el.textContent === text) ||
  screen.queryAllByRole("alert").some((el) => el.textContent?.includes(text));
/** What has the focus: its accessible name, or the member it belongs to. */
const focused = () => {
  const el = document.activeElement as HTMLElement | null;
  return el?.dataset.member ?? el?.getAttribute("aria-label") ?? el?.textContent ?? "";
};

describe.each(["en", "pt-BR"] as const)("teams-actions (%s)", (language) => {
  test("Pause says the team is paused and moves the focus to Resume", async () => {
    const { words } = await openTeam(language);
    await click(words.pause);
    await settleMaybe(() => button(words.resume) !== null, 3000);
    await settleMaybe(() => focused() === words.resume, 3000);
    expect(said(words.paused)).toBe(true);
    expect(focused()).toBe(words.resume);
  });

  test("Resume says the team is resumed and moves the focus to Pause", async () => {
    const { words } = await openTeam(language);
    await click(words.pause);
    await settleMaybe(() => button(words.resume) !== null, 3000);
    await click(words.resume);
    await settleMaybe(() => button(words.pause) !== null, 3000);
    await settleMaybe(() => focused() === words.pause, 3000);
    expect(said(words.resumed)).toBe(true);
    expect(focused()).toBe(words.pause);
  });

  test("Close says the team is closed and the focus lands on the team's row", async () => {
    const { words } = await openTeam(language);
    await click(words.close);
    await confirm(words.closeConfirm);
    await settleMaybe(() => button(words.close) === null, 3000);
    await settleMaybe(() => focused() === words.row, 3000);
    expect(said(words.closed)).toBe(true);
    expect(focused()).toBe(words.row);
  });

  test("Remove worker says so and the focus lands on the next worker's row", async () => {
    const { words } = await openTeam(language);
    await click(words.removeW1);
    await confirm(words.removeConfirm);
    await settleMaybe(() => button(words.removeW1) === null, 3000);
    await settleMaybe(() => focused() === "w2", 3000);
    expect(said(words.removed)).toBe(true);
    expect(focused()).toBe("w2");
  });

  test("removing the last worker leaves the focus on Add worker", async () => {
    const { words } = await openTeam(language);
    await click(words.removeW1);
    await confirm(words.removeConfirm);
    await settleMaybe(() => button(words.removeW1) === null, 3000);
    await click(words.removeW2);
    await confirm(words.removeConfirm);
    await settleMaybe(() => focused() === words.addWorker, 3000);
    expect(focused()).toBe(words.addWorker);
  });

  test("Delete team says so and the focus lands on New team", async () => {
    const { words } = await openTeam(language);
    await click(words.close);
    await confirm(words.closeConfirm);
    await settleMaybe(() => button(words.close) === null, 3000);
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: words.menu }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await settleMaybe(() => screen.queryByRole("menuitem", { name: words.delete }) !== null, 3000);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: words.delete }));
    });
    await confirm(words.delete);
    await settleMaybe(() => screen.queryByLabelText(words.row) === null, 3000);
    await settleMaybe(() => focused() === words.newTeam, 3000);
    expect(said(words.deleted)).toBe(true);
    expect(focused()).toBe(words.newTeam);
  });

  test("a refused command says it was refused with the host's reason, and the team is unchanged", async () => {
    const { words } = await openTeam(language, "teams.pause");
    await click(words.pause);
    await settleMaybe(() => said(words.notDone), 3000);
    expect(said(words.notDone)).toBe(true);
    expect(button(words.pause) !== null).toBe(true);
    expect(said(words.paused)).toBe(false);
  });
});
