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

const stored = (...names: string[]) => ({
  v: 1,
  clients: names.map((name) => ({
    id: name.toLowerCase(),
    name,
    color: "indigo",
    rules: [],
    defaults: { vaultScope: false },
  })),
  overrides: {},
});

/** The app with one host, on the Clients screen. */
async function open(initial?: unknown) {
  const platform = memoryPlatform();
  if (initial) platform.items.set(CLIENTS_KEY, JSON.stringify(initial));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
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
const typeName = async (value: string) => {
  const field = screen.queryByLabelText("Nome do cliente") as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};
const names = () =>
  [...(screen.queryByRole("list", { name: "Clientes" })?.querySelectorAll("li") ?? [])].map(
    (li) => li.querySelector("[data-client-name]")?.textContent ?? "",
  );

describe("clients-ui: the Clients screen", () => {
  test("the route opens a screen that says there is no client yet", async () => {
    await open();
    expect(screen.queryByText("Nenhum cliente ainda")).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Clientes" })).toBeNull();
  });

  test("a client is created from its name and listed", async () => {
    const { store } = await open();
    await typeName("Acme");
    await click("Criar cliente");
    await settle(() => names().length === 1);
    expect(names()).toEqual(["Acme"]);
    expect(store.clients.list().map((c) => c.name)).toEqual(["Acme"]);
    expect((screen.queryByLabelText("Nome do cliente") as HTMLInputElement).value).toBe("");
  });

  test("a blank name, or one a client already has, cannot be created and says why", async () => {
    await open(stored("Acme"));
    await typeName("  ");
    expect(
      (screen.getByRole("button", { name: "Criar cliente" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await typeName("acme");
    expect(
      (screen.getByRole("button", { name: "Criar cliente" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText("Já existe um cliente com esse nome.")).not.toBeNull();
  });

  test("a client is renamed, recolored and moved in the order rules are tried", async () => {
    const { store } = await open(stored("Acme", "Beta"));
    await click("Renomear Acme");
    await typeName("Acme Corp");
    await click("Salvar nome");
    await settle(() => names()[0] === "Acme Corp");
    expect(names()).toEqual(["Acme Corp", "Beta"]);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Cor de Beta"), { target: { value: "rose" } });
    });
    expect(store.clients.list()[1]?.color).toBe("rose");
    await click("Subir Beta");
    await settle(() => names()[0] === "Beta");
    expect(names()).toEqual(["Beta", "Acme Corp"]);
    await click("Descer Beta");
    await settle(() => names()[0] === "Acme Corp");
    expect(names()).toEqual(["Acme Corp", "Beta"]);
  });

  test("a client is deleted after a confirmation, and its overrides go with it", async () => {
    const { store } = await open({
      ...stored("Acme", "Beta"),
      overrides: { "github.com/x/y": "acme" },
    });
    await click("Excluir Acme");
    expect(screen.queryByText(/Excluir o cliente Acme\?/)).not.toBeNull();
    expect(store.clients.list()).toHaveLength(2);
    await click("Excluir");
    await settle(() => names().length === 1);
    expect(names()).toEqual(["Beta"]);
    expect(store.clients.overrides()).toEqual({});
  });

  test("cancelling a rename or a delete leaves the client as it was", async () => {
    const { store } = await open(stored("Acme"));
    await click("Renomear Acme");
    await typeName("Outro");
    await click("Cancelar");
    expect((screen.queryByLabelText("Nome do cliente") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Salvar nome" })).toBeNull();
    await click("Excluir Acme");
    await click("Cancelar");
    expect(screen.queryByText(/Excluir o cliente Acme\?/)).toBeNull();
    expect(store.clients.list().map((c) => c.name)).toEqual(["Acme"]);
  });
});
