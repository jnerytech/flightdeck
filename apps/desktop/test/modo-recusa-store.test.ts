import { afterEach, describe, expect, test } from "bun:test";
import { AppStore, sessionKey } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

/** Issue #935: the store says whether the host took a mode change, so the picker can go back. */
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("modo-recusa: the store tells the picker whether the host took the mode (#935)", () => {
  test("a stricter mode is taken, a looser one is refused, and with no session open nothing is", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
    await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
    const none = await store.setMode("plan");
    const id = (await store.createSession(hostId, { cwd: d.project, prompt: "a" })) as string;
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status === "idle");
    store.select(hostId, id);
    const stricter = await store.setMode("plan");
    const looser = await store.setMode("acceptEdits");
    expect([none, stricter, looser]).toEqual([false, true, false]);
  });
});
