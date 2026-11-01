import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ALL_CLIENTS } from "../src/lib/client-scope.ts";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const client = (id: string, name: string) => ({
  id,
  name,
  color: "indigo",
  rules: [],
  defaults: { vaultScope: false },
});

function open(clients: unknown[]) {
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify({ v: 1, clients, overrides: {} }));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  return store;
}

const press = async (init: KeyboardEventInit) => {
  await act(async () => {
    fireEvent.keyDown(window, init);
  });
};
const next = () => press({ key: "C", altKey: true, shiftKey: true });

describe("clients-ui: the switch shortcut", () => {
  test("Alt+Shift+C walks all clients, each client in order, Unassigned, then all again", async () => {
    const store = open([client("acme", "Acme"), client("beta", "Beta")]);
    const seen = [store.getState().clientSelection];
    for (let i = 0; i < 4; i++) {
      await next();
      seen.push(store.getState().clientSelection);
    }
    expect(seen).toEqual([ALL_CLIENTS, "acme", "beta", UNASSIGNED, ALL_CLIENTS]);
  });

  test("with no client defined the shortcut does nothing", async () => {
    const store = open([]);
    await next();
    expect(store.getState().clientSelection).toBe(ALL_CLIENTS);
  });

  test("a client that was removed while selected sends the shortcut back to all clients", async () => {
    const store = open([client("acme", "Acme")]);
    await next();
    expect(store.getState().clientSelection).toBe("acme");
    await act(async () => store.clients.remove("acme"));
    await next();
    expect(store.getState().clientSelection).toBe(ALL_CLIENTS);
  });

  test("Alt+C alone and Alt+Shift with another key leave the selection alone", async () => {
    const store = open([client("acme", "Acme")]);
    await press({ key: "c", altKey: true });
    await press({ key: "x", altKey: true, shiftKey: true });
    expect(store.getState().clientSelection).toBe(ALL_CLIENTS);
  });
});
