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

const ALLOW = [{ match: { requester: "claude", action: "deploy-staging" }, decision: "allow" }];

/** A daemon with the actions service, and a store with a secret allowed there and one that is not. */
async function setup(platform = memoryPlatform().platform) {
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const here = await store.addSecret({
    name: "staging",
    type: "token",
    value: "v1",
    tags: ["staging"],
    allowedHosts: [hostId],
  });
  const elsewhere = await store.addSecret({
    name: "outro",
    type: "token",
    value: "v2",
    allowedHosts: ["outro-host"],
  });
  const sent = () =>
    daemon.commands.filter((c) => c.type === "vault.rules.set").map((c) => c.payload);
  return { store, daemon, hostId, here, elsewhere, sent, platform };
}

describe("regras-armazenamento: the app keeps each secret's rules and hands them to the daemon", () => {
  test("saving sends the rules with the secret's tags to the host and keeps them for the next start", async () => {
    const { store, here, sent, platform } = await setup();
    expect(await store.setVaultRules(here.id, ALLOW)).toEqual({ ok: true });
    expect(sent()).toEqual([{ secretId: here.id, tags: ["staging"], rules: ALLOW }]);
    expect(store.vaultRules(here.id)).toEqual(ALLOW);
    const again = new AppStore(platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    expect(again.vaultRules(here.id)).toEqual(ALLOW);
  });

  test("on connect, the rules of each secret allowed for that host go to it, and no other secret's", async () => {
    const { store, daemon, here, elsewhere, sent, platform } = await setup();
    await store.setVaultRules(here.id, ALLOW);
    await store.setVaultRules(elsewhere.id, ALLOW);
    store.dispose();
    daemon.commands.length = 0;
    // The app starts again on the same storage and connects to the same daemon.
    const again = new AppStore(platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    await again.init();
    await settle(() => sent().length > 0);
    expect(sent()).toEqual([{ secretId: here.id, tags: ["staging"], rules: ALLOW }]);
    expect(JSON.stringify(daemon.commands)).not.toContain(elsewhere.id);
  });

  test("rules a host refuses on connect show as a notice with its reason", async () => {
    const { store, daemon, here, platform } = await setup();
    await store.setVaultRules(here.id, ALLOW);
    store.dispose();
    daemon.refuse.set("vault.rules.set", "regra inválida");
    const again = new AppStore(platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    await again.init();
    await settle(() => again.getState().notices.some((n) => n.text === "regra inválida"));
    expect(again.getState().notices.map((n) => n.text)).toContain("regra inválida");
  });

  test("what the daemon refuses comes back with its reason, and the rules are not saved", async () => {
    const { store, daemon, here } = await setup();
    daemon.refuse.set("vault.rules.set", "allow para run_with_secret nunca é permitido");
    const result = await store.setVaultRules(here.id, [
      { match: { purpose: "run_with_secret" }, decision: "allow" },
    ]);
    expect(result).toEqual({
      ok: false,
      code: "bad_request",
      message: "allow para run_with_secret nunca é permitido",
    });
    expect(store.vaultRules(here.id)).toEqual([]);
  });

  test("when a second host refuses, the first gets the saved rules back, so no host keeps rules the app did not save", async () => {
    const { store, daemon, here } = await setup();
    await store.setVaultRules(here.id, ALLOW);
    const other = legacyDaemon(cleanups);
    other.features.push("actions");
    const otherId = await store.addHost({ name: "pi", url: other.url, token: TOKEN });
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    store.updateSecret(here.id, { allowedHosts: [store.getState().hosts[0]?.id ?? "", otherId] });
    other.refuse.set("vault.rules.set", "regra inválida");
    daemon.commands.length = 0;
    const looser = [{ id: "r1", match: {}, decision: "allow" }];
    expect(await store.setVaultRules(here.id, looser)).toEqual({
      ok: false,
      code: "bad_request",
      message: "regra inválida",
    });
    const sent = daemon.commands.filter((c) => c.type === "vault.rules.set").map((c) => c.payload);
    expect(sent).toEqual([
      { secretId: here.id, tags: ["staging"], rules: looser },
      { secretId: here.id, tags: ["staging"], rules: ALLOW },
    ]);
    expect(store.vaultRules(here.id)).toEqual(ALLOW);
  });
});
