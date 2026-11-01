import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SCOPE_RULE_PREFIX } from "../src/lib/client-vault.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
void screen;
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

const managed = (id: string, projectKey: string) => ({
  id,
  name: null,
  cwd: `/r/${id}`,
  status: "idle",
  permissionMode: "default",
  model: null,
  claudeSessionId: null,
  lastSeq: 0,
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T11:00:00.000Z",
  projectKey,
});
const OWN = { id: "mine", match: { purpose: "ssh" }, decision: "ask" };

interface Sent {
  secretId: string;
  rules: Array<{ id: string; decision?: string; match?: { project?: string; requester?: string } }>;
}

/** A host with the actions feature and one session in Acme's project; Acme keeps secrets tagged client:acme. */
async function open(scoped: boolean) {
  const platform = memoryPlatform(false, "pt-BR");
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  daemon.hub.managed = [managed("s1", "github.com/acme/api")];
  render(<App store={store} />);
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => store.getState().hub[hostId] !== undefined);
  const acme = store.clients.add("Acme");
  store.clients.addRule(acme?.id ?? "", { kind: "remote", pattern: "github.com/acme/*" });
  store.clients.setDefaults(acme?.id ?? "", { vaultTag: "client:acme", vaultScope: scoped });
  const secret = await store.vault.create({
    name: "token",
    type: "token",
    value: "v",
    tags: ["client:acme"],
    allowedHosts: [hostId],
  });
  const sent = () =>
    daemon.commands.filter((c) => c.type === "vault.rules.set").map((c) => c.payload as Sent);
  const lastFor = (id: string) =>
    sent()
      .filter((s) => s.secretId === id)
      .at(-1);
  return { store, platform, daemon, hostId, acme: acme?.id ?? "", secret, sent, lastFor };
}

const ids = (rules: Sent["rules"] | undefined) => (rules ?? []).map((r) => r.id);

describe("clients-vault: what a scoped secret is sent", () => {
  test("its own rules go after the client's, and what the editor reads is only its own", async () => {
    const { store, secret, lastFor } = await open(true);
    const done = await store.setVaultRules(secret.id, [OWN]);
    expect(done.ok).toBe(true);
    expect(ids(lastFor(secret.id)?.rules)).toEqual([
      `${SCOPE_RULE_PREFIX}${store.getState().clientList[0]?.id}:0:0`,
      `${SCOPE_RULE_PREFIX}${store.getState().clientList[0]?.id}:deny:claude`,
      `${SCOPE_RULE_PREFIX}${store.getState().clientList[0]?.id}:deny:automation`,
      `${SCOPE_RULE_PREFIX}${store.getState().clientList[0]?.id}:deny:workflow`,
      "mine",
    ]);
    expect(store.vaultRules(secret.id)).toEqual([OWN]);
  });

  test("the requester you is not denied by the generated rules", async () => {
    const { store, secret, lastFor } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    const denied = (lastFor(secret.id)?.rules ?? [])
      .filter((r) => r.decision === "deny")
      .map((r) => r.match?.requester);
    expect(denied).toEqual(["claude", "automation", "workflow"]);
  });

  test("a secret of no client is sent its own rules as they are", async () => {
    const { store, hostId, lastFor } = await open(true);
    const other = await store.vault.create({
      name: "loose",
      type: "token",
      value: "v",
      tags: [],
      allowedHosts: [hostId],
    });
    await store.setVaultRules(other.id, [OWN]);
    expect(lastFor(other.id)?.rules).toEqual([OWN]);
  });

  test("when a host connects it is sent the scoped rules too", async () => {
    const { store, platform, daemon, secret } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    const again = new AppStore(platform.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    const before = daemon.commands.length;
    render(<App store={again} />);
    await settle(() => daemon.commands.slice(before).some((c) => c.type === "vault.rules.set"));
    const payload = daemon.commands.slice(before).find((c) => c.type === "vault.rules.set")
      ?.payload as Sent;
    expect(ids(payload.rules).at(-1)).toBe("mine");
    expect(ids(payload.rules)[0]?.startsWith(SCOPE_RULE_PREFIX)).toBe(true);
  });
});

describe("clients-vault: turning scope on and off", () => {
  test("turning it on sends the scoped rules at once, turning it off sends the own rules back", async () => {
    const { store, acme, secret, lastFor } = await open(false);
    await store.setVaultRules(secret.id, [OWN]);
    expect(lastFor(secret.id)?.rules).toEqual([OWN]);
    await act(async () => {
      store.clients.setDefaults(acme, { vaultScope: true });
    });
    await settle(() => ids(lastFor(secret.id)?.rules).length > 1);
    expect(ids(lastFor(secret.id)?.rules).at(-1)).toBe("mine");
    expect(ids(lastFor(secret.id)?.rules)).toHaveLength(5);
    await act(async () => {
      store.clients.setDefaults(acme, { vaultScope: false });
    });
    await settle(() => ids(lastFor(secret.id)?.rules).length === 1);
    expect(lastFor(secret.id)?.rules).toEqual([OWN]);
  });

  test("a secret that was never scoped is not sent anything when scope is turned off", async () => {
    const { store, acme, sent } = await open(false);
    const before = sent().length;
    await act(async () => {
      store.clients.setDefaults(acme, { vaultScope: false });
    });
    await act(() => Bun.sleep(400));
    expect(sent().length).toBe(before);
  });
});

describe("clients-vault: when the client's projects change", () => {
  test("the rules are generated again and a notice says so", async () => {
    const { store, daemon, hostId, secret, lastFor } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    const before = ids(lastFor(secret.id)?.rules);
    daemon.hub.managed = [
      managed("s1", "github.com/acme/api"),
      managed("s2", "github.com/acme/web"),
    ];
    await act(() => store.refreshHub());
    await settle(() => ids(lastFor(secret.id)?.rules).length > before.length);
    expect(ids(lastFor(secret.id)?.rules).length).toBe(before.length + 1);
    await settle(() => store.getState().notices.some((n) => n.kind === "success"));
    expect(store.getState().notices.map((n) => n.text)).toContain(
      "As regras de segredos do cliente Acme mudaram com os projetos dele.",
    );
    expect(hostId).toBeTruthy();
  });

  test("a change that is only the person's own rules makes no notice", async () => {
    const { store, secret } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    await act(() => Bun.sleep(400));
    expect(store.getState().notices).toEqual([]);
  });
});
