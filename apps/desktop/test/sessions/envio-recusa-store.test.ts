import { afterEach, describe, expect, test } from "bun:test";
import { AppStore, sessionKey } from "../../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "../fixtures.ts";

/** Issue #4466: the store says whether the host took a message, so the box can give it back. */
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("envio-recusa: the store tells the box whether the host took the message (#4466)", () => {
  test("a message to an open session is taken; with no session open, or after the host closed it, it is not", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    const hostId = await store.roster.add({ name: "pc", url: d.listen().url, token: TOKEN });
    await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
    const none = await store.commands.send("a");
    const id = (await store.commands.create(hostId, { cwd: d.project, prompt: "a" })) as string;
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status === "idle");
    store.subscriptions.select(hostId, id);
    const taken = await store.commands.send("b");
    await store.commands.close();
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status === "ended");
    const refused = await store.commands.send("c");
    expect([none, taken, refused]).toEqual([false, true, false]);
  });
});
