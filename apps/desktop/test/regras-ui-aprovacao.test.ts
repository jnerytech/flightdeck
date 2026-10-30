import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { trayMenu } from "../src/lib/tray.ts";
import type { TrayAction } from "../src/platform/types.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const { AppStore, needsYou } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

/** A store on a fake daemon with the secret `prod-key`, and a way to push a phase 19 request. */
async function setup() {
  const mem = memoryPlatform();
  let tray: ((action: TrayAction) => void) | null = null;
  mem.platform.onTrayAction = (handler) => {
    tray = handler;
    return () => {
      tray = null;
    };
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  // init registers the tray's handler.
  await store.init();
  const daemon = legacyDaemon(cleanups);
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => daemon.asked.includes("vault.watch"));
  const meta = await store.addSecret({
    name: "prod-key",
    type: "token",
    value: "regras-value-1",
    allowedHosts: [hostId],
  });
  const push = (over: Record<string, unknown>) =>
    daemon.push({
      type: "vault.request",
      requestId: "r1",
      secretId: meta.id,
      purpose: "action:deploy:r1",
      requester: "claude",
      action: "deploy",
      params: {},
      approval: "first-per-session",
      decision: "ask",
      ruleId: "r-prod",
      reason: "prod pede aprovação a cada uso",
      once: false,
      needsHold: false,
      tags: ["prod"],
      expiresAt: Date.now() + 600_000,
      ...over,
    });
  const types = () => daemon.commands.map((c) => c.type).filter((t) => t.startsWith("vault."));
  const payload = (type: string) => daemon.commands.find((c) => c.type === type)?.payload;
  const fromTray = (action: TrayAction) => tray?.(action);
  return { store, daemon, hostId, push, types, payload, fromTray };
}

describe("regras-ui-aprovacao: a request that the rules decided", () => {
  test("allow is delivered without a question, whatever the action's own approval says", async () => {
    const { store, push, types } = await setup();
    push({ decision: "allow", approval: "always" });
    await settle(() => types().includes("vault.deliver"));
    expect(types()).toContain("vault.deliver");
    expect(types()).not.toContain("vault.approve");
    expect(needsYou(store.getState())).toEqual([]);
  });

  test("ask is put to the user even for an action that never asks, shows the rule that decided, and approving sends vault.approve before the delivery", async () => {
    const { store, hostId, push, types, payload } = await setup();
    push({ approval: "never" });
    await settle(() => needsYou(store.getState()).length === 1);
    const shown = JSON.stringify(needsYou(store.getState())[0]?.input);
    expect(shown).toContain("prod pede aprovação a cada uso");
    expect(shown).toContain("prod");
    await store.respondTo(hostId, "r1", "allow");
    await settle(() => types().includes("vault.deliver"));
    expect(types().filter((t) => t === "vault.approve" || t === "vault.deliver")).toEqual([
      "vault.approve",
      "vault.deliver",
    ]);
    expect(payload("vault.approve")).toEqual({ requestId: "r1", via: "app", scope: "once" });
  });

  test("a request that needs holding is high risk, the tray only opens it, and the approval says it was held 2 s", async () => {
    const { store, hostId, push, payload, types } = await setup();
    push({ needsHold: true });
    await settle(() => needsYou(store.getState()).length === 1);
    expect(needsYou(store.getState())[0]?.risk).toBe("high");
    expect(trayMenu(needsYou(store.getState())).items[0]?.actions).toEqual(["open"]);
    await store.respondTo(hostId, "r1", "allow");
    await settle(() => types().includes("vault.deliver"));
    expect(payload("vault.approve")).toEqual({
      requestId: "r1",
      via: "app",
      scope: "once",
      heldMs: 2000,
    });
  });

  test("where the rule allows it, the approval can be for the session", async () => {
    const { store, hostId, push, payload, types } = await setup();
    push({ once: true });
    await settle(() => needsYou(store.getState()).length === 1);
    await store.approveVaultForSession(hostId, "r1");
    await settle(() => types().includes("vault.deliver"));
    expect(payload("vault.approve")).toEqual({ requestId: "r1", via: "app", scope: "session" });
  });

  test("a request nobody answers leaves the queue when it expires, and the daemon is told", async () => {
    const { store, push, types } = await setup();
    push({ expiresAt: Date.now() + 300 });
    await settle(() => needsYou(store.getState()).length === 1);
    await settle(() => needsYou(store.getState()).length === 0, 3000);
    expect(needsYou(store.getState())).toEqual([]);
    await settle(() => types().includes("vault.deny"));
    expect(types()).toContain("vault.deny");
    expect(types()).not.toContain("vault.deliver");
  });

  test("approving from the tray tells the daemon it was the tray", async () => {
    const { store, hostId, push, payload, types, fromTray } = await setup();
    push({});
    await settle(() => needsYou(store.getState()).length === 1);
    fromTray({ key: `${hostId}/r1`, action: "approve" });
    await settle(() => types().includes("vault.deliver"));
    expect(payload("vault.approve")).toEqual({ requestId: "r1", via: "tray", scope: "once" });
  });
});
