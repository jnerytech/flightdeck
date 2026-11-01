import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SCOPE_RULE_PREFIX, stripGenerated } from "../src/lib/client-vault.ts";
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
  rules: Array<{ id: string; decision?: string; match?: Record<string, string> }>;
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
  // The toasts leave the list as soon as the App shows them: what was said is kept here.
  const said: string[] = [];
  const success = store.success.bind(store);
  store.success = (text: string) => {
    said.push(text);
    success(text);
  };
  const sent = () =>
    daemon.commands.filter((c) => c.type === "vault.rules.set").map((c) => c.payload as Sent);
  const lastFor = (id: string) =>
    sent()
      .filter((s) => s.secretId === id)
      .at(-1);
  return { store, platform, daemon, hostId, acme: acme?.id ?? "", secret, sent, lastFor, said };
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
    const { store, daemon, secret, lastFor, said } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    const before = ids(lastFor(secret.id)?.rules);
    daemon.hub.managed = [
      managed("s1", "github.com/acme/api"),
      managed("s2", "github.com/acme/web"),
    ];
    await act(() => store.refreshHub());
    await settle(() => ids(lastFor(secret.id)?.rules).length > before.length);
    expect(ids(lastFor(secret.id)?.rules).length).toBe(before.length + 1);
    await settle(() => said.length > 0);
    expect(said).toEqual(["As regras de segredos do cliente Acme mudaram com os projetos dele."]);
  });

  test("a change that is only the person's own rules makes no notice", async () => {
    const { store, secret, said } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    await act(() => Bun.sleep(400));
    expect(said).toEqual([]);
  });
});

describe("clients-vault: reading the rules back from a host", () => {
  const OWN2 = { id: "mine2", match: { purpose: "action" }, decision: "ask" };

  test("the generated rules are taken out, so what is read back is only the person's own", async () => {
    const { store, hostId, secret } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    expect(await store.readHostVaultRules(hostId, secret.id)).toEqual([OWN]);
  });

  test("scope on, read back, edit an own rule and save, scope off: the host ends with exactly the own rules", async () => {
    const { store, hostId, acme, secret, daemon } = await open(true);
    await store.setVaultRules(secret.id, [OWN]);
    const readBack = await store.readHostVaultRules(hostId, secret.id);
    expect(readBack).toEqual([OWN]);
    await store.setVaultRules(secret.id, [...(readBack ?? []), OWN2]);
    const held = daemon.vaultRules[secret.id] as Array<{ id: string }>;
    expect(held.filter((r) => r.id.startsWith(SCOPE_RULE_PREFIX)).length).toBe(5);
    expect(held.filter((r) => !r.id.startsWith(SCOPE_RULE_PREFIX))).toEqual([OWN, OWN2]);
    await act(async () => {
      store.clients.setDefaults(acme, { vaultScope: false });
    });
    await settle(() => (daemon.vaultRules[secret.id]?.length ?? 9) === 2);
    expect(daemon.vaultRules[secret.id]).toEqual([OWN, OWN2]);
  });

  test("a read-back that is not a list is nothing, and a host that does not answer gives none", async () => {
    const { store, hostId, secret } = await open(true);
    expect(stripGenerated([{ id: `${SCOPE_RULE_PREFIX}x:0` }, "odd", OWN])).toEqual(["odd", OWN]);
    expect(await store.readHostVaultRules("nowhere", secret.id)).toBeNull();
    expect(hostId).toBeTruthy();
  });
});

describe("clients-vault: another writer", () => {
  const OTHER = { id: "theirs", match: {}, decision: "allow" };

  async function reconnect(opened: Awaited<ReturnType<typeof open>>) {
    const again = new AppStore(opened.platform.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    const said: string[] = [];
    const success = again.success.bind(again);
    again.success = (text: string) => {
      said.push(text);
      success(text);
    };
    const errors: string[] = [];
    const fail = (again as unknown as { fail(e: unknown, text?: string): void }).fail.bind(again);
    (again as unknown as { fail(e: unknown, text?: string): void }).fail = (e, text) => {
      errors.push(text ?? String(e));
      fail(e, text);
    };
    render(<App store={again} />);
    return { again, said, errors };
  }

  test("rules the host holds without the client's generated ones are noticed on connect, and the scope is sent again", async () => {
    const opened = await open(true);
    await opened.store.setVaultRules(opened.secret.id, [OWN]);
    // Another app saved this secret's rules on the host: the generated ones are gone.
    opened.daemon.vaultRules[opened.secret.id] = [OTHER];
    const { errors } = await reconnect(opened);
    await settle(() => errors.length > 0);
    expect(errors).toEqual([
      "As regras do cliente Acme para o segredo token sumiram do host alfa: outro app salvou as regras dele. Foram enviadas de novo.",
    ]);
    await settle(() => (opened.daemon.vaultRules[opened.secret.id]?.length ?? 0) === 5);
    const held = opened.daemon.vaultRules[opened.secret.id] as Array<{ id: string }>;
    expect(held.at(-1)?.id).toBe("mine");
    expect(held.some((r) => r.id === "theirs")).toBe(false);
  });

  test("a host that holds nothing yet gets the rules without a warning", async () => {
    const opened = await open(true);
    await opened.store.setVaultRules(opened.secret.id, [OWN]);
    opened.daemon.vaultRules[opened.secret.id] = [];
    const { errors } = await reconnect(opened);
    await settle(() => (opened.daemon.vaultRules[opened.secret.id]?.length ?? 0) === 5);
    expect(errors).toEqual([]);
  });

  test("generated rules that are there but out of date are regenerated with the usual notice", async () => {
    const opened = await open(true);
    await opened.store.setVaultRules(opened.secret.id, [OWN]);
    const held = opened.daemon.vaultRules[opened.secret.id] as Array<{ id: string }>;
    // The host still has the rules of a time when the client had one project fewer.
    opened.daemon.vaultRules[opened.secret.id] = held.slice(1);
    const { said, errors } = await reconnect(opened);
    await settle(() => said.length > 0);
    expect(said).toEqual(["As regras de segredos do cliente Acme mudaram com os projetos dele."]);
    expect(errors).toEqual([]);
  });
});

describe("clients-vault: a host that refuses the generated rules", () => {
  test("is said, since the secret is then not held in its client", async () => {
    const { store, acme, daemon } = await open(false);
    const errors: string[] = [];
    const fail = (store as unknown as { fail(e: unknown, text?: string): void }).fail.bind(store);
    (store as unknown as { fail(e: unknown, text?: string): void }).fail = (e, text) => {
      errors.push(text ?? String(e));
      fail(e, text);
    };
    daemon.refuse.set("vault.rules.set", "too many rules");
    await act(async () => {
      store.clients.setDefaults(acme, { vaultScope: true });
    });
    await settle(() => errors.length > 0);
    expect(errors).toEqual([
      "O host alfa não aceitou as regras do cliente Acme para o segredo token: too many rules. O segredo não está preso ao cliente nesse host.",
    ]);
  });
});
