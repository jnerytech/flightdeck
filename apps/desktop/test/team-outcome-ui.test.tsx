import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TeamsPage } = await import("../src/ui/TeamsPage.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

afterEach(cleanup);

/**
 * Issue #1220: a team's outcome in one place. The coordinator's last report (`team_report`) is on
 * top of the team's card, as plain text; each worker's row says its branch and how many files it
 * changed; and when the coordinator reports the goal done, the person is told, in their language.
 */
const AT = "2026-11-08T10:00:00.000Z";
const TEAM = {
  id: "t1",
  name: "login",
  projectId: "p1",
  goal: "Implement the login.",
  coordinator: "s-c",
  checks: [],
  state: "active",
  pausedBy: null,
  instructionsVersion: "2",
  createdAt: AT,
  members: [
    {
      name: "login · coordinator",
      role: "coordinator",
      persona: null,
      model: null,
      cardId: null,
      sessionId: "s-c",
      address: null,
      sessionState: "idle",
    },
    {
      name: "login 1",
      role: "worker",
      persona: null,
      model: null,
      cardId: "c-1",
      sessionId: "s-w",
      address: null,
      sessionState: "idle",
      number: 1,
    },
  ],
};
// Markup in what a session wrote is shown as it is, never read as HTML.
const OUTCOME = "Login merged in PR #12. <b>not bold</b>";

function setup(lang: "en" | "pt-BR") {
  const { platform, notifications } = memoryPlatform(false, lang);
  const store = new AppStore(platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.loadProjects = async () => null;
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "teams.list") return { teams: [TEAM] };
    if (type === "teams.status") {
      return {
        team: TEAM,
        messages: 2,
        members: TEAM.members.map((m) => ({ ...m, lastReport: null, sent: 1, received: 1 })),
        outcome: { text: OUTCOME, at: AT, done: true },
      };
    }
    return null;
  }) as never;
  store.hostRequest = (async (_host: string, type: string, payload: { target?: string }) =>
    type === "changes.get" && payload.target === "card:c-1"
      ? { ok: true, data: { files: [{ path: "a" }, { path: "b" }, { path: "c" }] } }
      : { ok: false, code: "x", message: "x" }) as never;
  act(() =>
    (store as unknown as { update(patch: object): void }).update({
      hosts: [
        {
          id: "h1",
          name: "alfa",
          url: "ws://x",
          token: "",
          status: "online",
          info: null,
          hostInfo: { daemonVersion: "x", features: ["teams"] },
          incompatibility: null,
          daemonUpdate: null,
          sessions: [],
        },
      ],
      cards: { "h1/c-1": { id: "c-1", projectId: "p1", branch: "fd/login-1" } },
    }),
  );
  return { store, notifications };
}

const NAMES = {
  en: {
    outcome: "Outcome",
    done: "Done",
    branch: "Branch: fd/login-1",
    changed: "3 files changed",
    notified: { title: "Team login", body: "The coordinator reported the goal done." },
  },
  "pt-BR": {
    outcome: "Resultado",
    done: "Concluído",
    branch: "Branch: fd/login-1",
    changed: "3 arquivos alterados",
    notified: { title: "Time login", body: "A coordenadora relatou o objetivo concluído." },
  },
} as const;

describe("team-outcome-ui: a team's outcome in one place (#1220)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const n = NAMES[lang];

    test(`${lang}: the coordinator's report is on top, as plain text; each worker says its branch and its changes`, async () => {
      const { store } = setup(lang);
      render(
        <TooltipProvider>
          <TeamsPage store={store} go={() => {}} />
        </TooltipProvider>,
      );
      await settleMaybe(() => screen.queryByText(n.changed) !== null);
      const outcome = screen.queryByRole("region", { name: n.outcome });
      expect([
        outcome !== null,
        outcome?.textContent?.includes(OUTCOME) ?? false,
        outcome?.querySelector("b") === null,
        outcome ? within(outcome).queryByText(n.done) !== null : false,
        screen.queryByText(n.branch) !== null,
        screen.queryByText(n.changed) !== null,
        // A long report scrolls inside its box: the box takes the keyboard and is named by its title.
        outcome?.getAttribute("tabindex") === "0",
        document.getElementById(outcome?.getAttribute("aria-labelledby") ?? "")?.textContent,
      ]).toEqual([true, true, true, true, true, true, true, n.outcome]);
    });

    test(`${lang}: the coordinator reporting the goal done tells the person, once, in their language`, () => {
      const { store: made, notifications } = setup(lang);
      const frame = { type: "teams.updated", team: TEAM, reason: null, event: "report_done" };
      (made as unknown as { onTeams(host: string, f: unknown): void }).onTeams("h1", frame);
      (made as unknown as { onTeams(host: string, f: unknown): void }).onTeams("h1", {
        ...frame,
        event: undefined,
      });
      expect(notifications).toEqual([n.notified]);
    });
  }
});
