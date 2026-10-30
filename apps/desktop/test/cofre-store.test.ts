import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { VaultOutcome } from "../src/lib/vault-requests.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "store-test-value-789";
const FRAME = {
  type: "vault.request",
  requestId: "r1",
  secretId: "s1",
  purpose: "ssh",
  requester: "claude",
};

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

/** A store on a fake platform and a fake daemon, with a secret allowed for that host. */
async function setup(options: ConstructorParameters<typeof AppStore>[1] = {}) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000, ...options });
  const daemon = legacyDaemon(cleanups);
  const hostId = await store.addHost({ name: "h", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => daemon.asked.includes("external.watch"));
  const meta = await store.addSecret({
    name: "deploy",
    type: "token",
    value: VALUE,
    tags: ["prod"],
    allowedHosts: [hostId],
  });
  const outcomes: VaultOutcome[] = [];
  store.onVaultOutcome((outcome) => outcomes.push(outcome));
  return { store, daemon, hostId, meta, outcomes };
}

describe("cofre-store", () => {
  test("the state lists the vault's secrets with their metadata and never a value, and follows add and remove", async () => {
    const { store, meta } = await setup();
    expect(store.getState().secrets).toEqual([meta]);
    expect(meta.tags).toEqual(["prod"]);
    expect(JSON.stringify(store.getState()).includes(VALUE)).toBe(false);
    await store.removeSecret(meta.id);
    expect(store.getState().secrets).toEqual([]);
    expect(await store.vault.value(meta.id)).toBeNull();
  });

  test("a vault.request from the daemon is denied in this phase: the outcome says why and no vault.deliver is sent", async () => {
    const { daemon, meta, outcomes, hostId } = await setup();
    daemon.push({ ...FRAME, secretId: meta.id });
    await settle(() => outcomes.length > 0);
    expect(outcomes).toEqual([
      {
        hostId,
        secretId: meta.id,
        purpose: "ssh",
        requester: "claude",
        delivered: false,
        reason:
          "in this phase the daemon cannot ask the vault for secrets: only the uses the app starts are delivered",
      },
    ]);
    await Bun.sleep(50);
    expect(daemon.asked.includes("vault.deliver")).toBe(false);
  });

  test("a policy handed to the store can deliver: the daemon then gets vault.deliver with the value", async () => {
    const { daemon, meta, outcomes } = await setup({ vaultPolicy: () => ({ kind: "deliver" }) });
    daemon.push({ ...FRAME, secretId: meta.id });
    await settle(() => outcomes.length > 0);
    expect(outcomes.map((o) => o.delivered)).toEqual([true]);
    const sent = daemon.commands.find((c) => c.type === "vault.deliver")?.payload as
      | { secretId: string; value: string; purpose: string; requester: string }
      | undefined;
    expect(sent?.secretId).toBe(meta.id);
    expect(sent?.value).toBe(VALUE);
    expect(sent?.purpose).toBe("ssh");
    expect(sent?.requester).toBe("claude");
  });

  test("stopping the outcome listener stops the calls", async () => {
    const { store, daemon, meta } = await setup();
    const seen: VaultOutcome[] = [];
    const off = store.onVaultOutcome((outcome) => seen.push(outcome));
    off();
    daemon.push({ ...FRAME, secretId: meta.id });
    await Bun.sleep(150);
    expect(seen).toEqual([]);
  });
});
