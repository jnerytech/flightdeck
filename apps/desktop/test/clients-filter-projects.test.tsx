import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
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

const button = (name: string) => screen.queryByRole("button", { name });
const shown = () =>
  ["Abrir board de acme-api", "Abrir board de beta-app"].filter((n) => button(n) !== null);

/** Two projects on one host, each inside the folder a client claims; the host is open on the board picker. */
async function setup() {
  const d = makeDaemon(cleanups);
  const repos = ["acme-api", "beta-app"].map((name) => {
    const repo = join(d.root, name);
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    return repo;
  });
  const client = (id: string, name: string, path: string) => ({
    id,
    name,
    color: "indigo",
    rules: [{ id: `r-${id}`, kind: "folder", path }],
    defaults: { vaultScope: false },
  });
  const platform = memoryPlatform();
  platform.items.set(
    CLIENTS_KEY,
    JSON.stringify({
      v: 1,
      clients: [
        client("acme", "Acme", join(d.root, "acme-api")),
        client("beta", "Beta", join(d.root, "beta-app")),
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
  const hostId = store.getState().hosts[0]?.id ?? "";
  for (const path of repos) await store.hostCommand(hostId, "project.add", { path });
  await act(async () => store.router.push({ name: "projects", host: hostId, focus: "board" }));
  await settle(() => shown().length === 2);
  return { store, hostId };
}

describe("clients-filter: the Board picker", () => {
  test("lists every project of the host, then only the selected client's", async () => {
    const { store } = await setup();
    expect(shown()).toHaveLength(2);
    await act(async () => store.setClientSelection("acme"));
    await settle(() => shown().length === 1);
    expect(shown()).toEqual(["Abrir board de acme-api"]);
    await act(async () => store.setClientSelection("beta"));
    await settle(() => button("Abrir board de beta-app") !== null);
    expect(shown()).toEqual(["Abrir board de beta-app"]);
  });

  test("a client with no project on the host says so, and does not offer to add one", async () => {
    const { store } = await setup();
    await act(async () => store.setClientSelection(UNASSIGNED));
    await settle(() => screen.queryByText("Nenhum projeto deste cliente neste host.") !== null);
    expect(shown()).toEqual([]);
    expect(screen.queryByText("Nenhum projeto deste cliente neste host.")).not.toBeNull();
    expect(screen.queryByText("Nenhum projeto cadastrado.")).toBeNull();
  });

  test("the host's own Projects screen keeps listing all of them", async () => {
    const { store, hostId } = await setup();
    await act(async () => store.setClientSelection("acme"));
    await act(async () => store.router.push({ name: "projects", host: hostId }));
    await settle(() => button("Abrir board de beta-app") !== null);
    expect(shown()).toHaveLength(2);
  });
});
