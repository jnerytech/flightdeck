import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../../src/features/clients/domain/clients.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle } from "../wait.ts";

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

const acme = {
  id: "acme",
  name: "Acme",
  color: "indigo",
  rules: [{ id: "r1", kind: "remote", pattern: "github.com/acme/*" }],
  defaults: { vaultScope: false },
};

async function open(clients: unknown[] = []) {
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify({ v: 1, clients, overrides: {} }));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const daemon = legacyDaemon(cleanups);
  await act(() => store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }));
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
const box = (label: string) => {
  const found = screen.queryByLabelText(label) as HTMLTextAreaElement | null;
  expect(found).not.toBeNull();
  return found as HTMLTextAreaElement;
};

describe("clients-ui: moving the clients to another desktop", () => {
  test("Export shows the clients as text, ready to copy", async () => {
    await open([acme]);
    await click("Exportar clientes");
    const out = JSON.parse(box("Exportação dos clientes").value);
    expect(out.clients.map((c: { name: string }) => c.name)).toEqual(["Acme"]);
  });

  test("Import adds what is new, replaces what has the same id and says how many", async () => {
    const { store } = await open([acme]);
    const incoming = {
      v: 1,
      clients: [
        { ...acme, name: "Acme renamed" },
        { ...acme, id: "beta", name: "Beta", rules: [] },
      ],
      overrides: {},
    };
    await act(async () => {
      fireEvent.change(box("Colar uma exportação"), {
        target: { value: JSON.stringify(incoming) },
      });
    });
    await click("Importar");
    await settle(() => store.clients.list().length === 2);
    expect(store.clients.list().map((c) => c.name)).toEqual(["Acme renamed", "Beta"]);
    expect(screen.queryByText("Importado: 1 novo, 1 atualizado.")).not.toBeNull();
    expect(box("Colar uma exportação").value).toBe("");
  });

  test("Import of something that is not an export changes nothing and says so", async () => {
    const { store } = await open([acme]);
    await act(async () => {
      fireEvent.change(box("Colar uma exportação"), { target: { value: "isso não é json" } });
    });
    await click("Importar");
    expect(screen.queryByText("Isso não é uma exportação de clientes.")).not.toBeNull();
    expect(store.clients.list().map((c) => c.name)).toEqual(["Acme"]);
  });
});

/** True when a live line of this role on the page says exactly this. */
const said = (role: "status" | "alert", text: string) =>
  [...document.querySelectorAll(`[role=${role}]`)].some((el) => el.textContent === text);

describe("clients-ui: the transfer outcome is announced and the export can be copied (#4344)", () => {
  test("a bad paste is an alert, not a muted line", async () => {
    await open([acme]);
    await act(async () => {
      fireEvent.change(box("Colar uma exportação"), { target: { value: "isso não é json" } });
    });
    await click("Importar");
    expect(said("alert", "Isso não é uma exportação de clientes.")).toBe(true);
  });

  test("a second identical failure is announced again, as a new alert", async () => {
    await open([acme]);
    await act(async () => {
      fireEvent.change(box("Colar uma exportação"), { target: { value: "isso não é json" } });
    });
    await click("Importar");
    const first = document.querySelector("[role=alert]");
    expect(first).not.toBeNull();
    await click("Importar");
    const second = document.querySelector("[role=alert]");
    expect(second).not.toBeNull();
    expect(second === first).toBe(false);
  });

  test("an import that worked is a polite status line", async () => {
    await open([acme]);
    const incoming = { v: 1, clients: [{ ...acme, id: "beta", name: "Beta" }], overrides: {} };
    await act(async () => {
      fireEvent.change(box("Colar uma exportação"), {
        target: { value: JSON.stringify(incoming) },
      });
    });
    await click("Importar");
    expect(said("status", "Importado: 1 novo, 0 atualizados.")).toBe(true);
  });

  test("Copy puts the export on the clipboard", async () => {
    const { store } = await open([acme]);
    const copied: string[] = [];
    store.system.copyText = (async (text: string) => {
      copied.push(text);
      return true;
    }) as never;
    expect(screen.queryByRole("button", { name: "Copiar exportação" })).toBeNull();
    await click("Exportar clientes");
    await click("Copiar exportação");
    expect(copied).toEqual([store.clients.exportJson()]);
  });
});
