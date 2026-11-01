import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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

/** A secret of Acme (scope on or off) and one of nobody's, on the Vault screen. */
async function open(scoped: boolean) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  daemon.hub.managed = [managed("s1", "github.com/acme/api"), managed("s2", "github.com/acme/web")];
  render(<App store={store} />);
  const hostId = await store.addHost({ name: "alfa", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await settle(() => store.getState().hub[hostId] !== undefined);
  const acme = store.clients.add("Acme");
  store.clients.addRule(acme?.id ?? "", { kind: "remote", pattern: "github.com/acme/*" });
  store.clients.setDefaults(acme?.id ?? "", { vaultTag: "client:acme", vaultScope: scoped });
  await store.addSecret({ name: "do-acme", type: "token", value: "v", tags: ["client:acme"] });
  await store.addSecret({ name: "solto", type: "token", value: "v", tags: [] });
  await act(async () => store.router.push({ name: "vault" }));
  await settle(() => screen.queryByRole("button", { name: "Regras de do-acme" }) !== null);
  return { store };
}

const openRules = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: `Regras de ${name}` }) as HTMLElement);
  });
};
const note = () => screen.queryByRole("note", { name: "Regras geradas pelo cliente" });

describe("clients-vault: the rules editor of a scoped secret", () => {
  test("it says the client's generated rules come first and are not edited there", async () => {
    await open(true);
    await openRules("do-acme");
    await settle(() => note() !== null);
    expect(note()?.textContent).toBe(
      "Acme: 5 regras geradas vêm antes das suas e não se editam aqui. Desligue o escopo do cliente para tirá-las.",
    );
  });

  test("a secret of no scoped client has no such note", async () => {
    await open(true);
    await openRules("solto");
    await act(() => Bun.sleep(80));
    expect(note() !== null).toBe(false);
  });

  test("with the scope off there is no note either", async () => {
    await open(false);
    await openRules("do-acme");
    await act(() => Bun.sleep(80));
    expect(note() !== null).toBe(false);
  });
});
