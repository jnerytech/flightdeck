import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

describe("relay: a host that refuses the phase 21 watches and its directory", () => {
  test("stays online with no error: the app keeps working without them", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000, peersSyncMs: 20 });
    cleanups.push(() => store.dispose());
    const daemon = legacyDaemon(cleanups);
    daemon.features.push("messaging", "teams");
    for (const type of ["teams.watch", "messages.watch", "messages.directory"]) {
      daemon.refuse.set(type, `sem ${type}`);
    }
    await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
    await settle(() => daemon.commands.filter((c) => c.type === "messages.directory").length >= 2);
    expect(daemon.asked).toContain("teams.watch");
    expect(daemon.asked).toContain("messages.watch");
    expect(daemon.commands.filter((c) => c.type === "messages.directory").length).toBeGreaterThan(
      1,
    );
    expect(store.getState().hosts[0]?.status).toBe("online");
    expect(store.getState().error).toBeNull();
  });
});
