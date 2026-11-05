import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(6000);

describe("setup-live: the checklist learns from a real host (issue #164)", () => {
  test("when a host comes online its hooks and projects are looked at, with no reload", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    const hostId = store.getState().hosts[0]?.id ?? "";
    await settle(() => store.getState().hosts[0]?.status === "online");
    // The hooks are not installed on a fresh host.
    await settle(() => store.getState().setupProbes[hostId]?.hooks === "absent");
    await settle(() => store.getState().projects[hostId] !== undefined);
    expect(store.getState().setupProbes[hostId]?.hooks).toBe("absent");
  });
});
