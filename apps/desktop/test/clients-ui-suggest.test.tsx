import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

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

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const KEYS: Record<string, string> = {
  s1: "github.com/acme/api",
  s2: "github.com/beta/app",
  s3: "github.com/acme/web",
};
const managed = (id: string) => ({
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
  projectKey: KEYS[id],
});

const client = (name: string, rules: unknown[] = []) => ({
  id: name.toLowerCase(),
  name,
  color: "indigo",
  rules,
  defaults: { vaultScope: false },
});

/** The Clients screen on a host with three sessions in three projects (two owners). */
async function open(clients: unknown[] = [], overrides: Record<string, string | null> = {}) {
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify({ v: 1, clients, overrides }));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const daemon = legacyDaemon(cleanups);
  daemon.hub.managed = ["s1", "s2", "s3"].map(managed);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => store.getState().hub[store.getState().hosts[0]?.id ?? ""] !== undefined);
  await act(async () => store.router.push({ name: "clients" }));
  await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
  return { store };
}

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const suggestions = () =>
  [
    ...(screen.queryByRole("list", { name: "Sugestões de clientes" })?.querySelectorAll("li") ??
      []),
  ].map((li) => li.textContent ?? "");

describe("clients-ui: Suggest from what I have", () => {
  test("offers one client per owner, the largest first, and creates nothing until asked", async () => {
    const { store } = await open();
    expect(suggestions()).toEqual([]);
    await click("Sugerir a partir do que tenho");
    expect(suggestions()).toHaveLength(2);
    expect(suggestions()[0]).toContain("acme");
    expect(suggestions()[0]).toContain("github.com/acme/*");
    expect(suggestions()[0]).toContain("2 projetos");
    expect(suggestions()[1]).toContain("1 projeto");
    expect(store.clients.list()).toEqual([]);
  });

  test("accepting one creates the client with its rule, and the suggestion goes away", async () => {
    const { store } = await open();
    await click("Sugerir a partir do que tenho");
    await click("Criar acme");
    await settle(() => suggestions().length === 1);
    expect(store.clients.list().map((c) => c.name)).toEqual(["acme"]);
    expect(store.clients.list()[0]?.rules).toMatchObject([
      { kind: "remote", pattern: "github.com/acme/*" },
    ]);
    expect(suggestions()[0]).toContain("beta");
  });

  test("an owner that has a client by that name gets the rule added to it", async () => {
    const { store } = await open([client("Beta")]);
    await click("Sugerir a partir do que tenho");
    await click("Adicionar regra a Beta");
    await settle(() => (store.clients.list()[0]?.rules.length ?? 0) === 1);
    expect(store.clients.list()).toHaveLength(1);
  });

  test("with nothing to offer it says so", async () => {
    await open([
      client("Acme", [{ id: "r1", kind: "remote", pattern: "github.com/acme/*" }]),
      client("Beta", [{ id: "r2", kind: "remote", pattern: "github.com/beta/*" }]),
    ]);
    await click("Sugerir a partir do que tenho");
    expect(
      screen.queryByText("Nada a sugerir: todo projeto conhecido já tem cliente."),
    ).not.toBeNull();
  });
});

describe("clients-ui: what no client has, and what was pinned by hand", () => {
  test("says how many known projects have no client", async () => {
    await open([client("Acme", [{ id: "r1", kind: "remote", pattern: "github.com/acme/*" }])]);
    expect(screen.queryByText("Sem cliente: 1 projeto.")).not.toBeNull();
  });

  test("says nothing about it when every project has a client", async () => {
    await open([client("All", [{ id: "r1", kind: "remote", pattern: "github.com/*" }])]);
    expect(screen.queryByText(/^Sem cliente:/)).toBeNull();
  });

  test("lists the projects pinned by hand, and a pin is let go", async () => {
    const { store } = await open(
      [client("Acme", [{ id: "r1", kind: "remote", pattern: "github.com/acme/*" }])],
      { "github.com/beta/app": "acme", "github.com/acme/web": null },
    );
    const rows = () =>
      [
        ...(screen
          .queryByRole("list", { name: "Projetos fixados à mão" })
          ?.querySelectorAll("li") ?? []),
      ].map((li) => li.textContent ?? "");
    expect(rows()).toHaveLength(2);
    expect(rows().some((r) => r.includes("github.com/beta/app") && r.includes("Acme"))).toBe(true);
    expect(rows().some((r) => r.includes("github.com/acme/web") && r.includes("Sem cliente"))).toBe(
      true,
    );
    await click("Soltar github.com/beta/app");
    await settle(() => rows().length === 1);
    expect(store.clients.overrides()).toEqual({ "github.com/acme/web": null });
  });
});
