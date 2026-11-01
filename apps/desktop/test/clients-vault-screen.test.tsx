import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SCOPE_RULE_PREFIX } from "../src/lib/client-vault.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

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

/** Acme and Beta with a project each on a host that keeps the actions; one secret tagged client:acme. */
async function open(options: { tag?: string; allowedHosts?: (hostId: string) => string[] } = {}) {
  const platform = memoryPlatform(false, "pt-BR");
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  daemon.hub.managed = [managed("s1", "github.com/acme/api"), managed("s2", "github.com/beta/app")];
  render(<App store={store} />);
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => store.getState().hub[hostId] !== undefined);
  const acme = store.clients.add("Acme");
  store.clients.addRule(acme?.id ?? "", { kind: "remote", pattern: "github.com/acme/*" });
  const beta = store.clients.add("Beta");
  store.clients.addRule(beta?.id ?? "", { kind: "remote", pattern: "github.com/beta/*" });
  if (options.tag) store.clients.setDefaults(acme?.id ?? "", { vaultTag: options.tag });
  const secret = await store.addSecret({
    name: "token",
    type: "token",
    value: "v",
    tags: ["client:acme"],
    allowedHosts: options.allowedHosts?.(hostId) ?? [hostId],
  });
  await act(async () => store.router.push({ name: "clients" }));
  await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
  const sent = () =>
    daemon.commands
      .filter((c) => c.type === "vault.rules.set")
      .map((c) => c.payload as { secretId: string; rules: Array<{ id: string }> });
  return { store, daemon, hostId, acme: acme?.id ?? "", secret, sent };
}

const itemOf = (name: string) => {
  const found = [...document.querySelectorAll("li")].find(
    (li) => li.querySelector("[data-client-name]")?.textContent === name,
  );
  expect(found).toBeDefined();
  return found as HTMLElement;
};
const scopeBox = (name = "Acme") =>
  within(itemOf(name)).queryByLabelText(
    "Manter os segredos com essa tag só nos projetos do cliente",
  ) as HTMLInputElement | null;
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("clients-vault: the vault tag and the scope on the Clients screen", () => {
  test("the vault tag is saved with the other defaults", async () => {
    const { store } = await open();
    const field = within(itemOf("Acme")).queryByLabelText(
      "Tag do cofre",
    ) as HTMLInputElement | null;
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: "client:acme" } });
    });
    await click(within(itemOf("Acme")).queryByRole("button", { name: "Salvar padrões" }));
    expect(store.clients.list()[0]?.defaults.vaultTag).toBe("client:acme");
  });

  test("the scope cannot be turned on while the client has no vault tag", async () => {
    await open();
    expect(scopeBox()?.disabled).toBe(true);
  });

  test("turning it on shows the rules first, and nothing is sent until it is confirmed", async () => {
    const { store, sent, acme } = await open({ tag: "client:acme" });
    const before = sent().length;
    await click(scopeBox());
    await settle(() => screen.queryByText(/Ligar o escopo do cofre de Acme/) !== null);
    expect(screen.queryByText(/negar o Claude, as automações e os workflows/) !== null).toBe(true);
    expect(store.clients.list().find((c) => c.id === acme)?.defaults.vaultScope).toBe(false);
    expect(sent().length).toBe(before);
    await click(screen.queryByRole("button", { name: "Cancelar" }));
    expect(store.clients.list().find((c) => c.id === acme)?.defaults.vaultScope).toBe(false);
    expect(sent().length).toBe(before);
  });

  test("confirming turns it on and the host is sent the generated rules", async () => {
    const { store, sent, acme, secret } = await open({ tag: "client:acme" });
    await click(scopeBox());
    await settle(() => screen.queryByRole("button", { name: "Ligar" }) !== null);
    await click(screen.queryByRole("button", { name: "Ligar" }));
    expect(store.clients.list().find((c) => c.id === acme)?.defaults.vaultScope).toBe(true);
    await settle(() => sent().some((s) => s.secretId === secret.id));
    const last = sent()
      .filter((s) => s.secretId === secret.id)
      .at(-1);
    expect(last?.rules.every((r) => r.id.startsWith(SCOPE_RULE_PREFIX))).toBe(true);
    expect(last?.rules).toHaveLength(4);
  });

  test("turning it off needs no confirmation and the secret goes back to its own rules", async () => {
    const { store, sent, acme, secret } = await open({ tag: "client:acme" });
    await click(scopeBox());
    await click(await waitButton("Ligar"));
    await settle(() => sent().some((s) => s.secretId === secret.id));
    await click(scopeBox());
    await settle(
      () => store.clients.list().find((c) => c.id === acme)?.defaults.vaultScope === false,
    );
    await settle(
      () =>
        (sent()
          .filter((s) => s.secretId === secret.id)
          .at(-1)?.rules.length ?? 9) === 0,
    );
    expect(
      sent()
        .filter((s) => s.secretId === secret.id)
        .at(-1)?.rules,
    ).toEqual([]);
  });
});

async function waitButton(name: string): Promise<HTMLElement | null> {
  await settle(() => screen.queryByRole("button", { name }) !== null);
  return screen.queryByRole("button", { name });
}

describe("clients-vault: what could take a secret out of its client", () => {
  const rules = [{ id: "r1", match: { project: "github.com/beta/app" }, decision: "allow" }];

  test("a rule for another client's project, and a host without the client's projects, are said", async () => {
    const { store, secret } = await open({
      tag: "client:acme",
      allowedHosts: (hostId) => [hostId, "ghost"],
    });
    await store.setVaultRules(secret.id, rules);
    await settle(
      () => screen.queryByText(/uma regra libera ou pede o projeto de outro cliente/) !== null,
    );
    expect(screen.queryByText(/github\.com\/beta\/app/) !== null).toBe(true);
    expect(screen.queryByText(/pode ir para hosts sem projetos do cliente/) !== null).toBe(true);
    expect(screen.queryByText(/ghost/) !== null).toBe(true);
  });

  test("nothing is said when the secret stays inside its client", async () => {
    await open({ tag: "client:acme" });
    expect(screen.queryByText("Segredos que podem sair do cliente") !== null).toBe(false);
  });
});
