import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { trayMenu } from "../src/lib/tray.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

const { AppStore, needsYou } = await import("../src/lib/app-store.ts");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "aprovacao-test-value-456";

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

/** A store on a fake daemon, with the secret `deploy` allowed for that host. */
async function setup() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => daemon.asked.includes("vault.watch"));
  const meta = await store.addSecret({
    name: "deploy",
    type: "token",
    value: VALUE,
    allowedHosts: [hostId],
  });
  const frame = (over: Record<string, unknown>) => ({
    type: "vault.request",
    requestId: "r1",
    secretId: meta.id,
    purpose: "action:deploy-staging:r1",
    requester: "claude",
    action: "deploy-staging",
    params: { branch: "main" },
    approval: "always",
    ...over,
  });
  const sent = (type: string) => daemon.commands.filter((c) => c.type === type);
  return { store, daemon, hostId, meta, frame, sent };
}

describe("acoes-ui-aprovacao: a request of the daemon for an action, in Precisa de você", () => {
  test("the app asks the daemon for the vault's requests when it connects", async () => {
    const { daemon } = await setup();
    expect(daemon.asked).toContain("vault.watch");
  });

  test("an action request waits in the queue with what it will run, and approving delivers the secret", async () => {
    const { store, daemon, hostId, meta, frame, sent } = await setup();
    daemon.push(frame({}));
    await settle(() => needsYou(store.getState()).length === 1);
    const [item] = needsYou(store.getState());
    expect(item?.toolName).toBe("deploy-staging");
    expect(item?.hostId).toBe(hostId);
    expect(item?.risk).toBeUndefined();
    const shown = JSON.stringify(item?.input);
    for (const part of ["deploy", "Claude", "branch", "main"]) expect(shown).toContain(part);
    expect(shown).not.toContain(VALUE);
    expect(sent("vault.deliver")).toEqual([]);
    await store.respondTo(hostId, "r1", "allow");
    await settle(() => sent("vault.deliver").length === 1);
    const delivered = sent("vault.deliver")[0]?.payload as { secretId: string; value: string };
    expect(delivered.secretId).toBe(meta.id);
    expect(delivered.value).toBe(VALUE);
    expect(needsYou(store.getState())).toEqual([]);
  });

  test("denying tells the daemon at once and delivers nothing", async () => {
    const { store, daemon, hostId, frame, sent } = await setup();
    daemon.push(frame({}));
    await settle(() => needsYou(store.getState()).length === 1);
    await store.respondTo(hostId, "r1", "deny");
    await settle(() => sent("vault.deny").length === 1);
    expect(sent("vault.deny")[0]?.payload).toEqual({ requestId: "r1" });
    expect(sent("vault.deliver")).toEqual([]);
    expect(needsYou(store.getState())).toEqual([]);
  });

  test("a free command is a high-risk request that shows the command, the secrets and the host, and the tray never approves it", async () => {
    const { store, daemon, frame } = await setup();
    daemon.push(
      frame({
        action: undefined,
        params: undefined,
        approval: undefined,
        command: "make deploy",
        secrets: ["deploy"],
        host: "alfa",
      }),
    );
    await settle(() => needsYou(store.getState()).length === 1);
    const [item] = needsYou(store.getState());
    expect(item?.toolName).toBe("run_with_secret");
    expect(item?.risk).toBe("high");
    const shown = JSON.stringify(item?.input);
    for (const part of ["make deploy", "deploy", "alfa"]) expect(shown).toContain(part);
    expect(trayMenu(needsYou(store.getState())).items[0]?.actions).toEqual(["open"]);
  });

  test("a request that names no action is denied without a question", async () => {
    const { store, daemon, frame, sent } = await setup();
    daemon.push(frame({ action: undefined }));
    await settle(() => sent("vault.deny").length === 1);
    expect(sent("vault.deny")).toHaveLength(1);
    expect(needsYou(store.getState())).toEqual([]);
    expect(sent("vault.deliver")).toEqual([]);
  });

  test("an action that never asks is delivered at once", async () => {
    const { store, daemon, frame, sent } = await setup();
    daemon.push(frame({ approval: "never" }));
    await settle(() => sent("vault.deliver").length === 1);
    expect(sent("vault.deliver")).toHaveLength(1);
    expect(needsYou(store.getState())).toEqual([]);
  });
});
