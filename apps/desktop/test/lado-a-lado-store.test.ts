import { afterEach, describe, expect, test } from "bun:test";
import { AppStore, sessionKey } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const said = (store: AppStore, hostId: string, sessionId: string) =>
  (store.getState().sessions[sessionKey(hostId, sessionId)]?.items ?? []).flatMap((item) =>
    item.kind === "user" ? [item.text] : [],
  );

describe("lado-a-lado: following several sessions at once", () => {
  test("a watched session keeps streaming while another is open, and a released one stops", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen();
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
    const a = (await store.createSession(hostId, { cwd: d.project, prompt: "a" })) as string;
    const b = (await store.createSession(hostId, { cwd: d.project, prompt: "b" })) as string;
    await waitFor(() => store.getState().sessions[sessionKey(hostId, b)]?.status === "idle");

    const releaseA = store.watchSession(hostId, a);
    const releaseB = store.watchSession(hostId, b);
    await store.sendTo(hostId, a, "para A");
    await waitFor(() => said(store, hostId, a).includes("para A"), "A streams while B is open");

    // Opening nothing does not drop what the tiles follow.
    store.select(hostId, null);
    await store.sendTo(hostId, b, "para B");
    await waitFor(() => said(store, hostId, b).includes("para B"), "B streams unselected");

    releaseA();
    await store.sendTo(hostId, a, "depois de soltar");
    await Bun.sleep(300);
    expect(said(store, hostId, a)).not.toContain("depois de soltar");
    releaseB();
  });
});
