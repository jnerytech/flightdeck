import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { ALL_CLIENTS } from "../src/lib/client-scope.ts";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
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

const item = (title: string) => screen.queryByRole("listitem", { name: title });
const shown = () => ["Sessão Acme", "Sessão Beta", "Sessão Solta"].filter((t) => item(t) !== null);

const CLIENTS = {
  v: 1,
  clients: [
    {
      id: "acme",
      name: "Acme",
      color: "indigo",
      rules: [{ id: "r1", kind: "remote", pattern: "github.com/acme/*" }],
      defaults: { vaultScope: false },
    },
    {
      id: "beta",
      name: "Beta",
      color: "rose",
      rules: [{ id: "r2", kind: "remote", pattern: "github.com/beta/*" }],
      defaults: { vaultScope: false },
    },
  ],
  overrides: {},
};

/** Three projects on one host (Acme's, Beta's and one no client claims), a session in each. */
async function setup(stored: unknown = CLIENTS) {
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
  platform.items.set(CLIENTS_KEY, JSON.stringify(stored));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => store.router.push({ name: "hub" }));
  await settle(() => shown().length === 3);
  return { d, store, platform, repos };
}

describe("clients-filter: the Sessions screen", () => {
  test("all clients lists every session, and a client lists only its own", async () => {
    const { store } = await setup();
    expect(store.getState().clientSelection).toBe(ALL_CLIENTS);
    expect(shown()).toEqual(["Sessão Acme", "Sessão Beta", "Sessão Solta"]);
    await act(async () => store.setClientSelection("acme"));
    await settle(() => shown().length === 1);
    expect(shown()).toEqual(["Sessão Acme"]);
    await act(async () => store.setClientSelection("beta"));
    await settle(() => item("Sessão Beta") !== null);
    expect(shown()).toEqual(["Sessão Beta"]);
  });

  test("Unassigned lists what no client claims", async () => {
    const { store } = await setup();
    await act(async () => store.setClientSelection(UNASSIGNED));
    await settle(() => shown().length === 1);
    expect(shown()).toEqual(["Sessão Solta"]);
  });

  test("a change to the clients shows at once: a project that gains a rule moves", async () => {
    const { store } = await setup();
    await act(async () => store.setClientSelection(UNASSIGNED));
    await settle(() => shown().length === 1);
    await act(async () => {
      store.clients.addRule("acme", { kind: "remote", pattern: "github.com/other/*" });
    });
    await settle(() => shown().length === 0);
    expect(shown()).toEqual([]);
    expect(store.getState().clientList.map((c) => c.name)).toEqual(["Acme", "Beta"]);
  });

  test("the selection is kept for the next start, and a client that is gone falls back to all", async () => {
    const { store, platform } = await setup();
    await act(async () => store.setClientSelection("beta"));
    const next = new AppStore(platform.platform, { baseDelayMs: 60_000 });
    expect(next.getState().clientSelection).toBe("beta");
    await act(async () => {
      next.clients.remove("beta");
    });
    expect(next.getState().clientSelection).toBe(ALL_CLIENTS);
  });

  test("a selection that names nothing the app knows is refused", async () => {
    const { store } = await setup();
    await act(async () => store.setClientSelection("ghost"));
    expect(store.getState().clientSelection).toBe(ALL_CLIENTS);
  });

  test("with no client defined every session shows, whatever was kept", async () => {
    const { store } = await setup({ v: 1, clients: [], overrides: {} });
    expect(shown()).toHaveLength(3);
    await act(async () => store.setClientSelection("acme"));
    expect(store.getState().clientSelection).toBe(ALL_CLIENTS);
    expect(shown()).toHaveLength(3);
  });
});

describe("clients-filter: what a client never hides", () => {
  test("a request waiting in another client's project stays in Needs you", async () => {
    const { d, store, repos } = await setup();
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
    expect(needsYou(store.getState())).toHaveLength(1);
    await act(async () => store.setClientSelection("acme"));
    await settle(() => shown().length === 1);
    expect(shown()).toEqual(["Sessão Acme"]);
    expect(needsYou(store.getState())).toHaveLength(1);
  });
});
