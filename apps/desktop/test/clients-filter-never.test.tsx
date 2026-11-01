import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
import type { TrayMenu } from "../src/platform/types.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

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

/** Acme and Beta, a session in each, Acme selected, and a request waiting in Beta's project. */
async function setup() {
  const d = makeDaemon(cleanups);
  const repos = {
    acme: clone(d.root, "acme-api", "https://github.com/acme/api.git"),
    beta: clone(d.root, "beta-app", "https://github.com/beta/app.git"),
  };
  for (const [name, cwd] of [
    ["Sessão Acme", repos.acme],
    ["Sessão Beta", repos.beta],
  ] as const) {
    const { sessionId } = d.manager.create({ cwd, prompt: "oi", name });
    await poll(() => d.manager.get(sessionId).status === "idle");
  }
  const platform = memoryPlatform(false);
  const menus: TrayMenu[] = [];
  platform.platform.setTrayMenu = async (menu) => {
    menus.push(menu);
  };
  platform.items.set(
    CLIENTS_KEY,
    JSON.stringify({
      v: 1,
      clients: [
        client("acme", "Acme", "github.com/acme/*"),
        client("beta", "Beta", "github.com/beta/*"),
      ],
      overrides: {},
    }),
  );
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => store.setClientSelection("acme"));
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
  return { store, platform, menus };
}

describe("clients-filter: the tray, the notifications and the global search", () => {
  test("with Acme selected, Beta's waiting request still reaches the tray menu and a notification", async () => {
    const { store, platform, menus } = await setup();
    expect(store.getState().clientSelection).toBe("acme");
    expect(needsYou(store.getState())).toHaveLength(1);
    await settle(() => (menus.at(-1)?.items.length ?? 0) === 1, 3000);
    expect(menus.at(-1)?.items.length).toBe(1);
    await settle(() => platform.notifications.length > 0, 3000);
    expect(platform.notifications.length > 0).toBe(true);
  });

  test("with Acme selected, the global search finds the sessions of every client", async () => {
    await setup();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const dialog = screen.queryByRole("dialog", { name: "Busca global" });
    const option = (label: string) =>
      dialog?.querySelector(`[role='option'][aria-label='${label}']`) ?? null;
    await settle(() => option("Sessão Beta") !== null);
    expect(option("Sessão Acme") !== null).toBe(true);
    expect(option("Sessão Beta") !== null).toBe(true);
  });
});
