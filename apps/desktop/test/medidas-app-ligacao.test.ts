import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { MEASURES_FLAG } from "../src/lib/measures.ts";
import { Router } from "../src/lib/router.ts";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();

const cleanups: Array<() => unknown> = [];
const frames: Array<() => void> = [];
const realRaf = globalThis.requestAnimationFrame;
const flush = () => {
  for (let i = 0; i < 2; i++) for (const f of frames.splice(0)) f();
};
const measured = () => performance.getEntriesByType("measure").map((m) => m.name);

beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: () => void) => frames.push(cb)) as never;
  performance.clearMarks();
  performance.clearMeasures();
  localStorage.setItem(MEASURES_FLAG, "1");
});
afterEach(async () => {
  globalThis.requestAnimationFrame = realRaf;
  localStorage.removeItem(MEASURES_FLAG);
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("medidas-app: where the measures start", () => {
  test("opening a session, a board or a card marks the click; other routes do not", () => {
    const router = new Router({ name: "hub" });
    router.push({ name: "settings" });
    expect(performance.getEntriesByType("mark")).toEqual([]);
    router.push({ name: "session", host: "h", id: "s" });
    router.push({ name: "board", host: "h", projectId: "p" });
    router.push({ name: "card", host: "h", projectId: "p", cardId: "c" });
    expect(performance.getEntriesByType("mark").map((m) => m.name)).toEqual([
      "fd:open-session:start",
      "fd:open-board:start",
      "fd:open-card:start",
    ]);
  });

  test("send and approve are measured from the call to the paint after the answer", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen();
    const mem = memoryPlatform(false);
    const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(
      () => store.getState().hosts.find((h) => h.id === hostId)?.status === "online",
      "online",
    );
    await store.createSession(hostId, { cwd: d.project, prompt: "oi", name: "s1" });
    await store.send("de novo");
    await store.respondTo(hostId, "pedido-inexistente", "allow");
    flush();
    expect(measured()).toEqual(["fd:send", "fd:approve"]);
  });
});
