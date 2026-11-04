import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(6000);

async function setup() {
  const d = makeDaemon(cleanups, { checkpoints: true });
  const { sessionId } = await d.manager.create({ cwd: d.project, prompt: "oi", name: "Alpha" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id as string;
  return { ...d, store, hostId, sessionId };
}

describe("telas-rotas: routes that open a screen", () => {
  test("forking from the last answer opens the new session", async () => {
    const { store, hostId, sessionId, manager } = await setup();
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    await settle(() => screen.queryByRole("button", { name: "Bifurcar a partir daqui" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bifurcar a partir daqui" }));
    });
    await settle(() => manager.list().length === 2);
    await settle(() => {
      const route = store.router.current;
      return route.name === "session" && route.id !== sessionId;
    });
  });

  test("a project route shows the project page, which says when the host lacks the project", async () => {
    const { store, hostId } = await setup();
    await act(async () => {
      store.router.push({ name: "project", host: hostId, projectId: "nope" });
    });
    await settle(() => screen.queryByText("Este projeto não está neste host.") !== null);
  });

  test("the pin button of an open session pins it and flips to the pressed state", async () => {
    const { store, hostId, sessionId } = await setup();
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    const pin = () => screen.queryByRole("button", { name: "Fixar sessão" });
    await settle(() => pin() !== null);
    expect(pin()?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fireEvent.click(pin() as HTMLElement);
    });
    await settle(() => pin()?.getAttribute("aria-pressed") === "true");
    const metas = Object.entries(store.getState().meta);
    expect(metas).toHaveLength(1);
    expect(metas[0]?.[1]?.pinned).toBe(true);
    await act(async () => {
      fireEvent.click(pin() as HTMLElement);
    });
    await settle(() => pin()?.getAttribute("aria-pressed") === "false");
    expect(Object.values(store.getState().meta)[0]?.pinned).toBe(false);
  });

  test("a history route with a folder opens the history filtered by it", async () => {
    const { store, hostId, project } = await setup();
    await act(async () => {
      store.router.push({ name: "history", host: hostId, cwd: project });
    });
    await settle(
      () => (screen.queryByLabelText("Pasta") as HTMLInputElement | null)?.value === project,
    );
  });

  test("a screen whose chunk is not loaded yet shows the loading label until it arrives", async () => {
    const { store } = await setup();
    const { TContext } = await import("../src/i18n/context.tsx");
    const { translator } = await import("../src/i18n/index.ts");
    const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");
    // A second instance of the module: its lazy screens start unloaded, unlike the preloaded ones.
    const specifier = "../src/ui/Screens.tsx?unloaded";
    const fresh = (await import(specifier)) as typeof import("../src/ui/Screens.tsx");
    const noop = () => {};
    cleanup();
    render(
      <TContext.Provider value={translator("en")}>
        <TooltipProvider>
          <fresh.Screen
            route={{ name: "snippets" }}
            store={store}
            state={store.getState()}
            theme="system"
            density="comfortable"
            go={noop}
            onOpenRequest={noop}
          />
        </TooltipProvider>
      </TContext.Provider>,
    );
    expect(screen.queryByRole("status", { name: "Loading…" })).not.toBeNull();
    await settle(() => screen.queryByRole("status", { name: "Loading…" }) === null);
  });
});
