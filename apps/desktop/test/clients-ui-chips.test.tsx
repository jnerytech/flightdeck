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

const group = (name: string) => {
  const found = screen.queryByRole("region", { name: `Projeto ${name}` });
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
const chip = (name: string) => group(name).querySelector("[data-client-chip]")?.textContent ?? null;
const assignButton = (name: string) =>
  within(group(name)).queryByRole("button", { name: `Atribuir ${name} a um cliente` });
async function openAssign(name: string) {
  const button = assignButton(name);
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(button as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
const menu = () =>
  [...document.querySelectorAll("[role='menuitem']")].map((el) => el.textContent ?? "");
const pick = async (text: RegExp) => {
  const el = [...document.querySelectorAll("[role='menuitem']")].find((e) =>
    text.test(e.textContent ?? ""),
  );
  expect(el).toBeDefined();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("clients-ui: chips on the projects", () => {
  test("with all clients shown, each project of a client wears its name, and an unassigned one none", async () => {
    await setup(TWO, false);
    expect(chip("api")).toBe("Acme");
    expect(chip("app")).toBe("Beta");
    expect(chip("x")).toBeNull();
  });

  test("with one client selected the chip is not repeated", async () => {
    const { store } = await setup(TWO, false);
    await act(async () => store.setClientSelection("acme"));
    expect(chip("api")).toBeNull();
  });

  test("with no client at all there is no chip and nothing to assign", async () => {
    await setup([], false);
    expect(screen.queryByRole("region", { name: "Projeto x" })).not.toBeNull();
    expect(document.querySelector("[data-client-chip]")).toBeNull();
    expect(assignButton("x")).toBeNull();
  });
});

describe("clients-ui: assigning a project that has no client", () => {
  test("only an unassigned project offers it", async () => {
    await setup(TWO, false);
    expect(assignButton("x")).not.toBeNull();
    expect(assignButton("api")).toBeNull();
  });

  test("it offers each client, and a new client with a rule made from the project's owner", async () => {
    await setup(TWO, false);
    await openAssign("x");
    expect(menu()).toEqual([
      "Atribuir a Acme",
      "Atribuir a Beta",
      "Criar o cliente other com a regra github.com/other/*",
    ]);
  });

  test("choosing a client pins the project to it by hand", async () => {
    const { store } = await setup(TWO, false);
    await openAssign("x");
    await pick(/^Atribuir a Beta/);
    await settle(() => chip("x") === "Beta");
    expect(store.clients.overrides()).toEqual({ "github.com/other/x": "beta" });
  });

  test("making the rule creates the client with it, and the project joins", async () => {
    const { store } = await setup(TWO, false);
    await openAssign("x");
    await pick(/^Criar o cliente other/);
    await settle(() => chip("x") === "other");
    expect(store.clients.list().map((c) => c.name)).toEqual(["Acme", "Beta", "other"]);
  });

  test("a client with the owner's name gets the rule instead of a new client", async () => {
    const { store } = await setup(
      [...TWO, client("other", "Other", "github.com/nothing/*")],
      false,
    );
    await openAssign("x");
    expect(menu()).toContain("Adicionar a regra github.com/other/* a Other");
    await pick(/^Adicionar a regra/);
    await settle(() => chip("x") === "Other");
    expect(store.clients.list()).toHaveLength(3);
  });
});

describe("clients-ui: chips on what waits for you", () => {
  test("a request in Needs you names the client of its project", async () => {
    const { store } = await setup();
    await act(async () => store.router.push({ name: "needs-you" }));
    await settle(() => document.querySelector("[data-client-chip]") !== null);
    const item = document.querySelector("li [data-client-chip]");
    expect(item?.textContent).toBe("Beta");
  });
});
