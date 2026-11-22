import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TeamsPage } = await import("../../src/features/teams/page.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

afterEach(cleanup);

/** What a member's row says about its session and its last report (#4019, #4022). */
const REPORTED = "2026-11-08T10:00:00.000Z";
const NOW = Date.parse(REPORTED) + 2 * 3_600_000;
const member = (name: string, role: string, extra: object) => ({
  name,
  role,
  persona: null,
  model: null,
  cardId: null,
  sessionId: null,
  address: null,
  sessionState: null,
  ...extra,
});
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
  createdAt: REPORTED,
  members: [
    member("login · coordinator", "coordinator", { sessionId: "s-c", sessionState: "idle" }),
    member("login 1", "worker", { sessionId: "s-w", sessionState: "idle", number: 1 }),
    member("login 2", "worker", {}),
  ],
};

function setup(lang: "en" | "pt-BR", reportAt: string) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.now = () => NOW;
  store.projectList.load = async () => null;
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "teams.list") return { teams: [TEAM] };
    if (type === "teams.status") {
      return {
        team: TEAM,
        messages: 2,
        members: TEAM.members.map((m) => ({
          ...m,
          lastReport: m.name === "login 1" ? { text: "Merged the login.", at: reportAt } : null,
          sent: 1,
          received: 1,
        })),
        outcome: null,
      };
    }
    return null;
  }) as never;
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
    }),
  );
  render(
    <TooltipProvider>
      <TeamsPage store={store} go={() => {}} />
    </TooltipProvider>,
  );
  return store;
}

const reportLine = () =>
  Array.from(document.querySelectorAll("p")).find((p) =>
    p.textContent?.includes("Merged the login."),
  );

describe("team-member-row: when the last report was made (#4019)", () => {
  test("en: the report says how long ago it was, and its exact time is in the title", async () => {
    const store = setup("en", REPORTED);
    await settleMaybe(() => reportLine() !== undefined);
    const time = reportLine()?.querySelector("time");
    expect([
      reportLine()?.textContent,
      time?.getAttribute("title") === store.formatDateTime(REPORTED),
      time?.getAttribute("datetime"),
    ]).toEqual(["Last report · 2 h ago: Merged the login.", true, REPORTED]);
  });

  test("pt-BR: the age is in the app's language", async () => {
    setup("pt-BR", REPORTED);
    await settleMaybe(() => reportLine() !== undefined);
    expect(reportLine()?.textContent).toBe("Último relato · há 2 h: Merged the login.");
  });

  test("a report time the app cannot read shows the report without an age, and does not throw", async () => {
    setup("en", "not a date");
    await settleMaybe(() => reportLine() !== undefined);
    expect([reportLine()?.textContent, reportLine()?.querySelector("time") === null]).toEqual([
      "Last report: Merged the login.",
      true,
    ]);
  });
});
