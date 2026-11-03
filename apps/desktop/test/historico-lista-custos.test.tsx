import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { HistoryList } = await import("../src/ui/HistoryList.tsx");
const { translator } = await import("../src/i18n/index.ts");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);
const settle = waiter(3000);

const SESSION = {
  claudeSessionId: "s-1",
  title: "Review the build",
  cwd: "/home/ana/app",
  lastTs: "2026-09-01T10:00:00.000Z",
  origin: "flightdeck",
  maybeActive: false,
  automated: false,
};

function fakeStore(opts: { sessions: unknown[]; features?: string[]; view?: "cards" | "list" }) {
  const asked: Array<{ command: string; args: unknown }> = [];
  const pushed: unknown[] = [];
  const i18n = { t: translator("en") };
  const store = {
    i18n,
    getState: () => ({ hosts: [{ id: "h", hostInfo: { features: opts.features } }] }),
    hubView: () => opts.view ?? "cards",
    saveHubView: () => {},
    historyList: () => Promise.resolve({ sessions: opts.sessions, automatedCount: 0 }),
    hostCommand: (_h: string, command: string, args: unknown) => {
      asked.push({ command, args });
      return Promise.resolve({ costs: { "s-1": 1.25 } });
    },
    formatDateTime: (ts: string) => ts,
    router: { push: (route: unknown) => pushed.push(route) },
  } as unknown as AppStore;
  return { store, asked, pushed };
}

const mount = (store: AppStore) =>
  act(async () => {
    render(
      <HistoryList
        store={store}
        hostId="h"
        hostName="alpha"
        density="comfortable"
        openId={null}
        onOpen={() => {}}
      />,
    );
  });

describe("historico-lista-custos: the history list of a host", () => {
  test("cards of a host with the costs feature ask for the costs and show them", async () => {
    const { store, asked } = fakeStore({ sessions: [SESSION], features: ["costs"] });
    await mount(store);
    await settle(() => document.querySelector("[data-slot='history-card']") !== null);
    await settle(() => (document.body.textContent ?? "").includes("US$ 1.25"));
    expect(asked).toEqual([{ command: "costs.sessions", args: { claudeSessionIds: ["s-1"] } }]);
  });

  test("a host without the costs feature is not asked for costs", async () => {
    const { store, asked } = fakeStore({ sessions: [SESSION], features: [] });
    await mount(store);
    await settle(() => document.querySelector("[data-slot='history-card']") !== null);
    expect(asked).toEqual([]);
    expect(document.body.textContent).not.toContain("US$");
  });

  test("an empty history offers to start a new session", async () => {
    const { store, pushed } = fakeStore({ sessions: [], view: "list" });
    await mount(store);
    await settle(() => screen.queryByText("No sessions in the history.") !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });
    expect(pushed).toEqual([{ name: "new-session", host: "h" }]);
  });
});
