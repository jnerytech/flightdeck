import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

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

const clone = (root: string, name: string, remote: string) => {
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", remote);
  return repo;
};

const client = (id: string, name: string, pattern: string) => ({
  id,
  name,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});
const TWO = [
  client("acme", "Acme", "github.com/acme/*"),
  client("beta", "Beta", "github.com/beta/*"),
];

/** Three projects with a session each (Acme's, Beta's, none's), a request waiting in Beta's. */
async function setup(clients: unknown[] = TWO, waiting = true) {
  const d = makeDaemon(cleanups);
  const repos = {
    acme: clone(d.root, "acme-api", "https://github.com/acme/api.git"),
    beta: clone(d.root, "beta-app", "https://github.com/beta/app.git"),
    solta: clone(d.root, "solta-x", "https://github.com/other/x.git"),
  };
  for (const [name, cwd] of [
    ["Sessão Acme", repos.acme],
    ["Sessão Beta", repos.beta],
    ["Sessão Solta", repos.solta],
  ] as const) {
    const { sessionId } = d.manager.create({ cwd, prompt: "oi", name });
    await poll(() => d.manager.get(sessionId).status === "idle");
  }
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify({ v: 1, clients, overrides: {} }));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => store.router.push({ name: "hub" }));
  await settle(() => screen.queryByRole("listitem", { name: "Sessão Solta" }) !== null);
  if (waiting) {
    d.central.hooksInstall(true);
    const token = loadConfig(d.configFile).hooks.token ?? "";
    const hook = (event: string, body: Record<string, unknown> = {}) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          session_id: "ext-beta",
          hook_event_name: event,
          cwd: repos.beta,
          ...body,
        }),
      })
        .then((r) => r.text())
        .catch(() => "");
    await hook("SessionStart");
    await hook("UserPromptSubmit", { prompt: "grave" });
    void hook("PermissionRequest", {
      tool_name: "Write",
      tool_input: { file_path: "a.txt", content: "x" },
    });
    await settle(() => Object.keys(store.getState().externalRequests).length === 1);
  }
  return { store };
}

const trigger = (name: string | RegExp = /^Cliente:/) => screen.queryByRole("button", { name });
async function openMenu() {
  const button = trigger();
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(button as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
const choices = () =>
  [...document.querySelectorAll("[role='menuitemradio'], [role='menuitem']")].map(
    (el) => el.textContent ?? "",
  );
const choice = (name: RegExp) => {
  const el = [...document.querySelectorAll("[role='menuitemradio'], [role='menuitem']")].find((e) =>
    name.test(e.textContent ?? ""),
  );
  expect(el).toBeDefined();
  return el as HTMLElement;
};

describe("clients-ui: the client switcher", () => {
  test("it does not exist while no client does", async () => {
    await setup([], false);
    expect(trigger()).toBeNull();
  });

  test("it names the selected client, and lists all clients, each client, Unassigned and Manage", async () => {
    await setup(TWO, false);
    expect(trigger("Cliente: Todos os clientes")).not.toBeNull();
    await openMenu();
    const names = choices();
    expect(names).toHaveLength(5);
    expect(names[0]).toMatch(/^Todos os clientes/);
    expect(names[1]).toMatch(/^Acme/);
    expect(names[2]).toMatch(/^Beta/);
    expect(names[3]).toMatch(/^Sem cliente/);
    expect(names[4]).toMatch(/^Gerenciar clientes/);
  });

  test("choosing a client selects it for the screens", async () => {
    const { store } = await setup(TWO, false);
    await openMenu();
    await act(async () => {
      fireEvent.click(choice(/^Beta/));
    });
    expect(store.getState().clientSelection).toBe("beta");
    expect(trigger("Cliente: Beta")).not.toBeNull();
  });

  test("Unassigned is named on the button when it is the selection", async () => {
    const { store } = await setup(TWO, false);
    await act(async () => store.setClientSelection(UNASSIGNED));
    expect(trigger("Cliente: Sem cliente")).not.toBeNull();
  });

  test("each client shows how many sessions are busy, and Unassigned how many projects it holds", async () => {
    await setup();
    await openMenu();
    await settle(() => (choices()[2] ?? "").includes("1"));
    expect(choice(/^Beta/).textContent).toContain("1");
    expect(choice(/^Acme/).textContent).not.toContain("1");
    expect(choice(/^Sem cliente/).textContent).toContain("1");
  });

  test("a request waiting in another client puts a mark on the button", async () => {
    const { store } = await setup();
    expect(screen.queryByRole("img", { name: /em outros clientes/ })).toBeNull();
    await act(async () => store.setClientSelection("acme"));
    expect(
      screen.queryByRole("img", { name: "Esperando por você em outros clientes: 1" }),
    ).not.toBeNull();
    await act(async () => store.setClientSelection("beta"));
    expect(screen.queryByRole("img", { name: /em outros clientes/ })).toBeNull();
  });

  test("Manage clients opens the Clients screen", async () => {
    const { store } = await setup(TWO, false);
    await openMenu();
    await act(async () => {
      fireEvent.click(choice(/^Gerenciar clientes/));
    });
    expect(store.router.current).toEqual({ name: "clients" });
  });
});
