import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { trayMenu } from "../src/lib/tray.ts";
import type { TrayAction } from "../src/platform/types.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settlePlain as settle, stays } from "./wait.ts";

const { AppStore, needsYou } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

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

// Issue #244 (OpenCode approval review, H1 and H3): approvals that skipped what a person must see.
describe("approval-safety: a vault grant needs what the person must see", () => {
  test("H1: a free command the rule allows once per session is still high risk, so it gets no one-click session approval", async () => {
    const { store, hostId, push, types } = await setup();
    push({ command: "deploy.sh --prod", action: undefined, once: true });
    await settle(() => needsYou(store.getState()).length === 1);
    const item = needsYou(store.getState())[0];
    expect(item?.risk).toBe("high");
    expect(item?.vaultOnce).toBeUndefined();
    await store.approveVaultForSession(hostId, "r1");
    await stays(() => !types().includes("vault.approve"), 300);
    expect(types()).not.toContain("vault.approve");
  });

  test("H1: a high-risk vault item is never approved for the session, whatever it carries", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const granted: unknown[] = [];
    const hidden = store as unknown as {
      state: { vaultApprovals: unknown[] };
      vaultQuestions: Map<string, (answer: unknown) => void>;
    };
    hidden.vaultQuestions.set("v1", (answer) => granted.push(answer));
    hidden.state = {
      ...hidden.state,
      vaultApprovals: [
        {
          hostId: "h",
          hostName: "alfa",
          sessionId: "",
          sessionName: "Claude",
          requestId: "v1",
          toolName: "run_with_secret",
          createdAt: "2026-11-05T10:00:00Z",
          vault: true,
          vaultOnce: true,
          risk: "high",
        },
      ],
    };
    await store.approveVaultForSession("h", "v1");
    expect(granted).toEqual([]);
  });

  test("H3: the tray never grants a vault request: it offers only Open, and an Approve that reaches it opens it", async () => {
    const { store, hostId, push, types, fromTray } = await setup();
    const opened: string[] = [];
    store.onOpenRequest((item) => opened.push(item.requestId));
    push({});
    await settle(() => needsYou(store.getState()).length === 1);
    // Issue #245 (L1): Deny needs no hold, so the tray offers it; only Approve takes the window.
    expect(trayMenu(needsYou(store.getState())).items[0]?.actions).toEqual(["deny", "open"]);
    fromTray({ key: `${hostId}/r1`, action: "approve" });
    await stays(() => !types().includes("vault.approve"), 300);
    expect(types()).not.toContain("vault.approve");
    expect(opened).toEqual(["r1"]);
  });
});
