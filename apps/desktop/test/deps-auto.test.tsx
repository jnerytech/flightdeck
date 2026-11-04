import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { DepsResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

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

const RESULT: DepsResult = {
  items: [
    { id: "claude", group: "required", state: "ok", breaks: [], fix: [] },
    { id: "gh", group: "optional", state: "missing", breaks: ["github"], fix: [] },
  ],
};
const MIN = 60_000;

/** One host that counts how many times it was asked for its dependencies, on a clock the test drives. */
async function connected() {
  const asks = { deps: 0 };
  const d = makeDaemon(cleanups, {
    firstRun: true,
    deps: () => {
      asks.deps++;
      return RESULT;
    },
  });
  const clock = { at: Date.parse("2026-11-04T12:00:00.000Z") };
  const store = new AppStore(memoryPlatform().platform, {
    baseDelayMs: 60_000,
    now: () => clock.at,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  });
  const hostId = await pollFor(() => store.getState().hosts[0]?.id, "the host");
  await pollFor(() => asks.deps >= 1 || undefined, "the first check");
  return { store, hostId, asks, clock };
}

describe("deps-auto: the health of a host is read by itself", () => {
  test("it is read when the host connects, with the doctor, and the time is kept", async () => {
    const { store, hostId, asks, clock } = await connected();
    await pollFor(() => store.getState().healthAt[hostId] || undefined, "the time");
    expect(asks.deps).toBe(1);
    expect(store.getState().healthAt[hostId]).toBe(clock.at);
    expect(store.getState().deps[hostId]?.items).toHaveLength(2);
    expect(store.getState().doctor[hostId]?.checks.length).toBeGreaterThan(0);
  });

  test("ensureHealth leaves a fresh read alone and reads again once it is five minutes old", async () => {
    const { store, hostId, asks, clock } = await connected();
    await pollFor(() => store.getState().healthAt[hostId] || undefined, "the time");
    clock.at += 4 * MIN;
    await store.ensureHealth(hostId);
    expect(asks.deps).toBe(1);
    clock.at += 2 * MIN;
    await store.ensureHealth(hostId);
    expect(asks.deps).toBe(2);
    expect(store.getState().healthAt[hostId]).toBe(clock.at);
  });

  test("a reconnect, as after a daemon update, reads it again", async () => {
    const { store, hostId, asks } = await connected();
    await act(async () => {
      await store.reconnectHost(hostId);
    });
    await pollFor(() => asks.deps >= 2 || undefined, "the second check");
    expect(asks.deps).toBe(2);
  });

  test("the host page says when it was read, and opening it after five minutes reads again", async () => {
    const { store, hostId, asks, clock } = await connected();
    await pollFor(() => store.getState().healthAt[hostId] || undefined, "the time");
    clock.at += 3 * MIN;
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "Abrir host pc" })),
    );
    const section = await pollFor(
      () => screen.queryByRole("region", { name: "Saúde e dependências" }) ?? undefined,
      "the section",
    );
    expect(section.textContent).toContain("Verificado há 3 min");
    expect(asks.deps).toBe(1);
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    clock.at += 3 * MIN;
    await act(async () => {
      store.router.push({ name: "host", host: hostId });
    });
    await pollFor(() => asks.deps >= 2 || undefined, "the check on opening");
  });
});
