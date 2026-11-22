import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../../src/features/clients/domain/clients.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

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
  await act(() => store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => store.router.push({ name: "clients" }));
  await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
  return { store };
}

const button = (name: string) => screen.queryByRole("button", { name });
const press = async (name: string) => {
  const found = button(name);
  expect(found).not.toBeNull();
  await act(async () => {
    fireEvent.click(found as HTMLElement);
  });
  await uiIdle();
  await uiIdle();
};
const typeName = async (value: string) => {
  const field = screen.queryByLabelText("Nome do cliente");
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};
/** True when a polite status line on the page says exactly this. */
const said = (text: string) =>
  [...document.querySelectorAll("[role=status]")].some((el) => el.textContent === text);
const focusedOn = (element: Element | null) =>
  element !== null && document.activeElement === element;
const nameField = () => screen.queryByLabelText("Nome do cliente");

describe("clients: a rename says which client it renames and keeps the focus (#4344)", () => {
  test("Rename names the client in the form and moves the focus to the name field", async () => {
    await open(stored("Acme", "Beta"));
    await press("Renomear Acme");
    expect(screen.queryByRole("heading", { name: "Renomear Acme" })).not.toBeNull();
    expect(focusedOn(nameField())).toBe(true);
  });

  test("saving the name says so and moves the focus to that client's Rename button", async () => {
    await open(stored("Acme", "Beta"));
    await press("Renomear Acme");
    await typeName("Acme Corp");
    await press("Salvar nome");
    expect(said("Cliente renomeado: Acme Corp")).toBe(true);
    expect(focusedOn(button("Renomear Acme Corp"))).toBe(true);
  });

  test("cancelling moves the focus back to the Rename button of the client", async () => {
    await open(stored("Acme", "Beta"));
    await press("Renomear Beta");
    await press("Cancelar");
    expect(focusedOn(button("Renomear Beta"))).toBe(true);
  });
});

describe("clients: creating a client says so and keeps the focus (#4344)", () => {
  test("the new client is named in a status line and the focus stays on the name field", async () => {
    await open(stored("Acme"));
    await typeName("Beta");
    await press("Criar cliente");
    expect(said("Cliente criado: Beta")).toBe(true);
    expect(focusedOn(nameField())).toBe(true);
  });

  test("the empty state says what a client is for and where to create one", async () => {
    await open();
    expect(
      screen.queryByText(
        "Um cliente agrupa os projetos de vários hosts. Crie o primeiro com o campo abaixo.",
      ),
    ).not.toBeNull();
  });
});

describe("clients: moving and recoloring say what happened and keep the focus (#4344)", () => {
  test("a move says the new position and the focus stays on the arrow that was pressed", async () => {
    await open(stored("Acme", "Beta", "Cora"));
    await press("Descer Acme");
    expect(said("Acme movido para a posição 2 de 3")).toBe(true);
    expect(focusedOn(button("Descer Acme"))).toBe(true);
  });

  test("a client that reaches the end moves the focus to its twin arrow", async () => {
    await open(stored("Acme", "Beta"));
    await press("Descer Acme");
    expect(said("Acme movido para a posição 2 de 2")).toBe(true);
    expect(focusedOn(button("Subir Acme"))).toBe(true);
    await press("Subir Acme");
    expect(said("Acme movido para a posição 1 de 2")).toBe(true);
    expect(focusedOn(button("Descer Acme"))).toBe(true);
  });

  test("a new color is named in a status line", async () => {
    await open(stored("Acme"));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Cor de Acme"), { target: { value: "rose" } });
    });
    expect(said("Cor de Acme: Rosa")).toBe(true);
  });
});

describe("clients: deleting a client says so and moves the focus to a control that exists (#4344)", () => {
  test("the focus goes to the Rename button of the client that took its place", async () => {
    await open(stored("Acme", "Beta"));
    await press("Excluir Acme");
    await press("Excluir");
    expect(said("Cliente excluído: Acme")).toBe(true);
    expect(focusedOn(button("Renomear Beta"))).toBe(true);
  });

  test("the last client of the list hands the focus to the one before it", async () => {
    await open(stored("Acme", "Beta"));
    await press("Excluir Beta");
    await press("Excluir");
    expect(focusedOn(button("Renomear Acme"))).toBe(true);
  });

  test("deleting the client being renamed closes the rename form", async () => {
    await open(stored("Acme", "Beta"));
    await press("Renomear Acme");
    await press("Excluir Acme");
    await press("Excluir");
    expect(screen.queryByRole("heading", { name: "Renomear Acme" })).toBeNull();
    expect(button("Salvar nome")).toBeNull();
    expect(button("Criar cliente")).not.toBeNull();
  });

  test("the only client hands the focus to the name field", async () => {
    await open(stored("Acme"));
    await press("Excluir Acme");
    await press("Excluir");
    expect(said("Cliente excluído: Acme")).toBe(true);
    expect(focusedOn(nameField())).toBe(true);
  });
});
