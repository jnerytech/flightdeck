import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const QUOTA = {
  pauseAt: null,
  windows: [
    {
      window: "five_hour",
      utilization: 0.4,
      status: "allowed",
      resetsAt: null,
      readAt: "2026-11-06T12:00:00.000Z",
    },
  ],
};

/** The app with one online host that reports its quota; the store's own calls are recorded. */
async function start(lang: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  // Settings is a screen that does not ask the fake host for its sessions.
  store.router.push({ name: "settings" });
  render(<App store={store} />);
  await uiIdle();
  // After the app's own start-up, which resets the hosts.
  await act(async () => {
    (store as unknown as { update(patch: object): void }).update({
      hosts: [{ id: "a", name: "alfa", status: "online", sessions: [] }],
      quota: { a: QUOTA },
    });
  });
  return store;
}

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`status-bar-app (${lang}): the bar wired into the app (issue #491)`, () => {
    test("the refresh button asks the store for the quota and waits while it asks", async () => {
      const store = await start(lang);
      let answer: () => void = () => {};
      let asked = 0;
      store.refreshQuota = () => {
        asked += 1;
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      };
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: dict.statusBar.refreshQuota }));
      });
      expect(asked).toBe(1);
      const busy = screen.queryByRole("button", { name: dict.statusBar.refreshingQuota });
      expect(busy?.hasAttribute("disabled")).toBe(true);
      await act(async () => {
        answer();
      });
      await settle(
        () => screen.queryByRole("button", { name: dict.statusBar.refreshQuota }) !== null,
      );
    });

    test("with no terminal tab the terminals item goes to the host page, with one it brings that tab forward", async () => {
      const store = await start(lang);
      const name = dict.statusBar.terminals.replace("{n}", "0");
      // The route is recorded, not opened: the host page would ask the fake host for its data.
      const routes: unknown[] = [];
      store.router.push = ((route: unknown) => routes.push(route)) as never;
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name }));
      });
      expect(routes).toEqual([{ name: "host", host: "a" }]);

      const opened = store.workspace.tabs.open(
        { name: "terminal", host: "a", terminalId: "t1" },
        { background: true },
      );
      const brought: string[] = [];
      store.workspace.focusArea = ((area: number) => brought.push(`area:${area}`)) as never;
      store.workspace.tabs.activate = ((id: string) => brought.push(`tab:${id}`)) as never;
      await settle(
        () => screen.queryByRole("button", { name: dict.statusBar.terminalsOne }) !== null,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: dict.statusBar.terminalsOne }));
      });
      expect(brought).toEqual(["area:0", `tab:${opened.id}`]);
    });
  });
}
