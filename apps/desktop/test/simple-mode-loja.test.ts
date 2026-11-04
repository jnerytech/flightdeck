import { afterEach, describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A host that says what it says about its mode, and a store connected to it. */
async function setup(ui: { mode: "full" | "simple"; locked: boolean }, mem = memoryPlatform()) {
  const d = makeDaemon(cleanups, { ui });
  const server = d.listen();
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui);
  return { store, hostId, mem };
}

describe("simple-mode-loja: the app's mode per host", () => {
  test("Given a host set to simple, When the app opens it, Then it is in simple mode and the person can switch", async () => {
    const { store, hostId } = await setup({ mode: "simple", locked: false });
    expect(store.uiMode(hostId)).toEqual({ mode: "simple", canSwitch: true });
  });

  test("Given a person who chose full on that host, Then full wins, is kept for the next start, and forgetting it brings the host's default back", async () => {
    const { store, hostId, mem } = await setup({ mode: "simple", locked: false });
    store.setUiChoice(hostId, "full");
    expect(store.uiMode(hostId).mode).toBe("full");
    expect(store.getState().uiChoices).toEqual({ [hostId]: "full" });
    const again = new AppStore(mem.platform, { baseDelayMs: 10 });
    cleanups.push(() => again.dispose());
    expect(again.getState().uiChoices).toEqual({ [hostId]: "full" });
    store.setUiChoice(hostId, null);
    expect(store.uiMode(hostId).mode).toBe("simple");
  });

  test("Given a locked host, Then the choice does not move it and there is no switch", async () => {
    const { store, hostId } = await setup({ mode: "simple", locked: true });
    store.setUiChoice(hostId, "full");
    expect(store.uiMode(hostId)).toEqual({ mode: "simple", canSwitch: false });
  });

  test("Given full mode, When the host's default is set to simple and locked, Then the host says so and the app follows", async () => {
    const { store, hostId } = await setup({ mode: "full", locked: false });
    expect(await store.setHostUi(hostId, { mode: "simple", locked: true })).toBe(true);
    expect(store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.ui).toEqual({
      mode: "simple",
      locked: true,
    });
    expect(store.uiMode(hostId)).toEqual({ mode: "simple", canSwitch: false });
  });

  test("Given a host without the setting (an older daemon), Then it is full", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo);
    expect(store.uiMode(hostId)).toEqual({ mode: "full", canSwitch: true });
  });
});
