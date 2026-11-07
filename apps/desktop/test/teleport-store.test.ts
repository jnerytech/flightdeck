import { describe, expect, test } from "bun:test";
import { AppStore, TELEPORT_PREVIEW_KEY } from "../src/lib/app-store.ts";
import { memoryPlatform } from "./fixtures.ts";

/**
 * Issue #100, slice 3b: the move of a session to another host is a preview the person turns on in
 * Settings (off by default); the relay reaches each host through the store's own connections.
 */
describe("teleport-store: the preview switch and the hosts' channels (#100)", () => {
  test("the preview is off by default, and the person's choice is kept for the next start", async () => {
    const mem = memoryPlatform(false, "en");
    const store = new AppStore(mem.platform);
    await store.init();
    const before = store.getState().settings.teleportPreview;
    store.setTeleportPreview(true);
    const after = store.getState().settings.teleportPreview;
    const next = new AppStore(mem.platform);
    await next.init();
    expect([
      before,
      after,
      mem.items.get(TELEPORT_PREVIEW_KEY),
      next.getState().settings.teleportPreview,
    ]).toEqual([false, true, "true", true]);
    store.dispose();
    next.dispose();
  });

  test("a host the app does not know is refused as offline", async () => {
    const mem = memoryPlatform(false, "en");
    const store = new AppStore(mem.platform);
    const answer = await store
      .teleportRequest("nowhere")("teleport.cancel", { id: "p1" })
      .then(
        () => "answered",
        (error: { code?: string }) => error.code ?? String(error),
      );
    expect(answer).toBe("offline");
  });

  test("a move between hosts the app does not reach is refused as offline", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    const answer = await store
      .moveSession("alfa", "s1", {
        target: "beta",
        repo: "/work/app",
        confirm: async () => true,
        onProgress: () => {},
        signal: new AbortController().signal,
      })
      .then(
        () => "moved",
        (error: { code?: string }) => error.code ?? String(error),
      );
    expect(answer).toBe("offline");
  });

  test("the moved session opens on its new host", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    store.openMovedSession("beta", "t1");
    expect([store.router.current, store.getState().selected]).toEqual([
      { name: "session", host: "beta", id: "t1" },
      { hostId: "beta", sessionId: "t1" },
    ]);
  });
});
