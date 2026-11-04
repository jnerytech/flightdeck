import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { Screen } = await import("../src/ui/Screens.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
const settle = waiter(6000);

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.dispose();
});

const host = {
  id: "h1",
  name: "alfa",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: ["costs"], os: "linux", arch: "x64" },
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};

function setup(route: Route, hostCommand?: (type: string) => unknown) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  stores.push(store);
  store.i18n.start();
  store.loadPalette = async () => {};
  store.hostCommand = (async (_host: string, type: string) => hostCommand?.(type) ?? null) as never;
  const state = {
    ...store.getState(),
    hosts: [host],
    projects: {
      h1: [
        {
          id: "p-api",
          name: "api",
          path: "/work/api",
          baseBranch: "main",
          projectKey: "host:alfa:/work/api",
        },
      ],
    },
  } as never as ReturnType<typeof store.getState>;
  const went: Route[] = [];
  const view = (theStore = store) => (
    <TContext.Provider value={translator("en")}>
      <TooltipProvider>
        <Screen
          route={route}
          store={theStore}
          state={state}
          theme="system"
          density="comfortable"
          go={(r) => void went.push(r)}
          onOpenRequest={() => {}}
        />
      </TooltipProvider>
    </TContext.Provider>
  );
  return { store, view, went };
}

describe("telas-funcoes: callbacks the Screens module wires", () => {
  test("a project card of the overview routes to that project's page", async () => {
    const { view, went } = setup({ name: "all-projects" });
    render(view());
    await settle(() => screen.queryByRole("button", { name: /^Open project api/ }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Open project api/ }));
    });
    expect(went).toEqual([{ name: "project", host: "h1", projectId: "p-api" }]);
  });

  test("a usage row of the host page routes to the history of its folder and day", async () => {
    const { view, went } = setup({ name: "host", host: "h1" }, (type) =>
      type === "costs.summary"
        ? {
            byDay: [
              {
                day: "2026-10-15",
                projectKey: "host:alfa:/home/ana/app",
                costUsd: 1.5,
                tokens: 10,
              },
            ],
          }
        : null,
    );
    await act(async () => {
      render(view());
    });
    await settle(() => document.querySelector("tbody button") !== null);
    await act(async () => {
      fireEvent.click(document.querySelector("tbody button") as HTMLElement);
    });
    expect(went).toEqual([
      { name: "history", host: "h1", cwd: "/home/ana/app", day: "2026-10-15" },
    ]);
  });

  test("a screen that suspends shows the loading label until it can render", async () => {
    const { store, view } = setup({ name: "snippets" });
    let released = false;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = () => {
        released = true;
        resolve();
      };
    });
    let suspended = false;
    // The page reads the store while it renders; the first read suspends, like a chunk still loading.
    const slow = new Proxy(store, {
      get(target, key) {
        if (key === "getState") {
          return () => {
            if (!released) {
              suspended = true;
              throw pending;
            }
            return target.getState();
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    render(view(slow));
    expect(suspended).toBe(true);
    expect(screen.queryByRole("status", { name: "Loading…" })).not.toBeNull();
    await act(async () => {
      release();
      await pending;
    });
    await settle(() => screen.queryByRole("status", { name: "Loading…" }) === null);
  });
});
