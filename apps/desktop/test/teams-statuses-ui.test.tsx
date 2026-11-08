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

// The Teams page reads each team's state after its list (phase 21); the page is held to 100% since
// #932 changed how it picks its host.
describe("teams-statuses-ui: the page reads every team's state", () => {
  test("each listed team is asked for its state, one after the other", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const asked: string[] = [];
    store.loadProjects = async () => null;
    store.hostCommand = (async (_host: string, type: string, payload: { team?: string }) => {
      asked.push(payload.team ? `${type}:${payload.team}` : type);
      if (type === "teams.list") {
        return { teams: [{ id: "t1", name: "login", members: [], state: "running", goal: "x" }] };
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
    await settleMaybe(() => asked.includes("teams.status:t1"));
    expect(asked.filter((type) => type.startsWith("teams."))).toEqual([
      "teams.list",
      "teams.status:t1",
    ]);
  });
});
