import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_HUB_FILTER, hubGroups, hubRows } from "../src/lib/hub.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;

const HOST = {
  id: "h1",
  name: "h1",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};

const historyRow = (id: string, title: string) => ({
  claudeSessionId: id,
  cwd: "/work/beta",
  projectKey: "host:h1:/work/beta",
  title,
  summary: null,
  lastTs: "2026-11-06T09:00:00.000Z",
  firstTs: null,
  messageCount: 3,
});

/**
 * Issue #583: a session started from the terminal in beta whose hooks later report alpha (the
 * session moved into a sibling folder). Its transcript, and so the history, says beta.
 */
function state(store: Store) {
  return {
    ...store.getState(),
    hosts: [HOST],
    hub: {
      h1: { managed: [], history: [historyRow("c1", "beta work"), historyRow("c2", "beta older")] },
    },
    externals: {
      "h1/c1": {
        claudeSessionId: "c1",
        cwd: "/work/alpha",
        projectKey: "host:h1:/work/alpha",
        status: "idle",
        controllable: false,
        lastEventAt: "2026-11-06T10:00:00.000Z",
        summary: null,
        persona: null,
      },
    },
  } as never as ReturnType<Store["getState"]>;
}

const newStore = (language: string) =>
  new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });

describe("session-project: a session sits under its transcript's project (#583)", () => {
  test("the terminal row takes the transcript's folder and project, and alpha gets no group", () => {
    const rows = hubRows(state(newStore("en"))).filter((r) => r.claudeSessionId === "c1");
    expect(rows.map((r) => [r.origin, r.cwd, r.projectKey])).toEqual([
      ["terminal", "/work/beta", "host:h1:/work/beta"],
    ]);
    const groups = hubGroups(hubRows(state(newStore("en"))), DEFAULT_HUB_FILTER);
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([["beta", 2]]);
  });

  for (const [language, filter] of [
    ["en", "Filter sessions"],
    ["pt-BR", "Filtrar sessões"],
  ] as const) {
    test(`the row says it is a terminal session with a chip; the group header says no origin (${language})`, async () => {
      const store = newStore(language);
      store.i18n.start();
      render(
        <TooltipProvider>
          <SessionsHub
            store={store}
            state={state(store)}
            onOpen={() => {}}
            isOpen={() => false}
            density="comfortable"
          />
        </TooltipProvider>,
      );
      const box = screen.queryByLabelText(filter);
      expect(box).not.toBeNull();
      await act(async () => {
        fireEvent.change(box as HTMLElement, { target: { value: "beta" } });
      });
      await uiIdle();
      const chips = [...document.querySelectorAll("li[aria-label] [data-slot='origin-chip']")];
      expect(chips.map((chip) => chip.textContent)).toEqual(["terminal"]);
      expect(document.querySelectorAll("[data-slot='group-meta']").length).toBe(0);
    });
  }
});
