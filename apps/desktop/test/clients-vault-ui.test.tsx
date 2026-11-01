import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
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

const client = (id: string, name: string, vaultTag: string) => ({
  id,
  name,
  color: "indigo",
  rules: [],
  defaults: { vaultScope: false, vaultTag },
});

/** Three secrets (Acme's, nobody's, Beta's) in the vault, on the Vault screen. */
async function open(selection: string) {
  const platform = memoryPlatform(false, "pt-BR");
  platform.items.set(
    CLIENTS_KEY,
    JSON.stringify({
      v: 1,
      clients: [client("acme", "Acme", "client:acme"), client("beta", "Beta", "client:beta")],
      overrides: {},
    }),
  );
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const daemon = legacyDaemon(cleanups);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  for (const [name, tags] of [
    ["s-acme", ["client:acme"]],
    ["s-solto", []],
    ["s-beta", ["client:beta"]],
  ] as const) {
    await store.addSecret({ name, type: "token", value: "v", tags: [...tags] });
  }
  if (selection !== "all") await act(async () => store.setClientSelection(selection));
  await act(async () => store.router.push({ name: "vault" }));
  await settle(() => screen.queryByRole("heading", { name: "Cofre" }) !== null);
  return { store };
}

const namesIn = (root: HTMLElement | null) =>
  [...(root?.querySelectorAll("li") ?? [])]
    .map((li) => li.textContent ?? "")
    .map((text) => ["s-acme", "s-solto", "s-beta"].find((n) => text.includes(n)) ?? "");
const region = (name: string) => screen.queryByRole("region", { name });

describe("clients-vault: the vault's list for a selected client", () => {
  test("with all clients the list is one list, as before", async () => {
    await open("all");
    expect(namesIn(screen.queryByRole("list", { name: "Segredos" }))).toHaveLength(3);
    expect(region("Segredos de Acme") !== null).toBe(false);
  });

  test("with a client selected its secrets come first, then nobody's, then the other clients', all shown", async () => {
    await open("acme");
    await settle(() => region("Segredos de Acme") !== null);
    expect(namesIn(region("Segredos de Acme"))).toEqual(["s-acme"]);
    expect(namesIn(region("Sem vínculo com cliente"))).toEqual(["s-solto"]);
    expect(namesIn(region("Segredos de outros clientes"))).toEqual(["s-beta"]);
  });

  test("a secret created with a client selected starts with its tag", async () => {
    await open("acme");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Novo segredo" }) as HTMLElement);
    });
    const tags = screen.queryByLabelText(
      "Etiquetas (separadas por vírgula)",
    ) as HTMLInputElement | null;
    expect(tags?.value).toBe("client:acme");
  });

  test("with all clients selected a new secret starts with no tag", async () => {
    await open("all");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Novo segredo" }) as HTMLElement);
    });
    const tags = screen.queryByLabelText(
      "Etiquetas (separadas por vírgula)",
    ) as HTMLInputElement | null;
    expect(tags?.value).toBe("");
  });
});
