import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "usage-store-value-321";

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

async function setup() {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  const hostId = await store.addHost({ name: "h", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => daemon.asked.includes("external.watch"));
  const meta = await store.addSecret({
    name: "deploy",
    type: "token",
    value: VALUE,
    allowedHosts: [hostId],
  });
  return { platform, store, daemon, hostId, meta };
}

describe("cofre-uso-store", () => {
  test("a refused vault.request lands in the state's usage log with the host, purpose and requester", async () => {
    const { store, daemon, hostId, meta } = await setup();
    daemon.push({
      type: "vault.request",
      requestId: "r1",
      secretId: meta.id,
      purpose: "ssh",
      requester: "claude",
    });
    await settle(() => store.getState().vaultUsage.length > 0);
    const [entry] = store.getState().vaultUsage;
    expect(entry).toMatchObject({
      secretId: meta.id,
      hostId,
      purpose: "ssh",
      requester: "claude",
      kind: "denied",
    });
  });

  test("a vault.used frame lands in the usage log with the action and the host that sent it", async () => {
    const { store, daemon, hostId, meta } = await setup();
    daemon.push({
      type: "vault.used",
      secretId: meta.id,
      purpose: "ssh",
      requester: "claude",
      action: "ssh deploy@box",
      at: "2026-10-30T10:00:00.000Z",
    });
    await settle(() => store.getState().vaultUsage.length > 0);
    expect(store.getState().vaultUsage[0]).toMatchObject({
      hostId,
      kind: "used",
      detail: "ssh deploy@box",
    });
  });

  test("the log is kept across stores on the same storage and holds no value", async () => {
    const { platform, store, daemon, meta } = await setup();
    daemon.push({
      type: "vault.request",
      requestId: "r1",
      secretId: meta.id,
      purpose: "ssh",
      requester: "claude",
    });
    await settle(() => store.getState().vaultUsage.length > 0);
    expect(new AppStore(platform).getState().vaultUsage).toHaveLength(1);
    expect(JSON.stringify(store.getState().vaultUsage)).not.toContain(VALUE);
  });
});
