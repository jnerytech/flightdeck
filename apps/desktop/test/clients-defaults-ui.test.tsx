import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";
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

const newStore = () => {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  return store;
};

/** A client whose folder rule is `path`, with the defaults given. */
function addClient(
  store: InstanceType<typeof AppStore>,
  name: string,
  path: string,
  defaults: { persona?: string; snippetTag?: string } = {},
) {
  const made = store.clients.add(name);
  store.clients.addRule(made?.id ?? "", { kind: "folder", path });
  store.clients.setDefaults(made?.id ?? "", { vaultScope: false, ...defaults });
  return made?.id ?? "";
}

const select = (label: string) => screen.queryByLabelText(label) as HTMLSelectElement | null;
const options = (label: string) => [...(select(label)?.options ?? [])].map((o) => o.value);
const choose = async (label: string, value: string) => {
  const field = select(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("clients-defaults: the persona a new session opens in", () => {
  async function open(persona: string | null, route: { persona?: string } = {}) {
    const store = newStore();
    const h = await personasHost(cleanups, store);
    if (persona !== null) addClient(store, "Acme", h.d.root, { persona });
    store.globalPersonas.save({ id: "minha", name: "Minha persona", description: "d", body: "b" });
    render(<App store={store} />);
    await settle(
      () => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true,
    );
    await act(async () => {
      store.router.push({ name: "new-session", host: h.hostId, ...route });
    });
    await settle(() => options("Persona").length > 1);
    return { store, ...h };
  }

  test("a folder of a client with a default persona opens the form with it chosen, and it can be changed", async () => {
    await open("host:seguranca");
    expect(select("Persona")?.value).toBe("host:seguranca");
    await choose("Persona", "");
    expect(select("Persona")?.value).toBe("");
  });

  test("a client without a default persona leaves the choice empty", async () => {
    await open("");
    expect(select("Persona")?.value).toBe("");
  });

  test("a persona the route asked for wins over the client's", async () => {
    await open("host:seguranca", { persona: "app:minha" });
    expect(select("Persona")?.value).toBe("app:minha");
  });

  test("the session opens in the default persona", async () => {
    const { d } = await open("host:seguranca");
    const prompt = screen.queryByLabelText("Primeiro prompt");
    await act(async () => {
      fireEvent.change(prompt as HTMLElement, { target: { value: "revise" } });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Criar sessão" }) as HTMLElement);
    });
    await poll(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.persona).toMatchObject({ id: "seguranca" });
  });
});

describe("clients-defaults: the persona of Claude here", () => {
  async function open(persona: string) {
    const store = newStore();
    const h = await personasHost(cleanups, store);
    addClient(store, "Acme", h.d.root, { persona });
    const { TerminalButton } = await import("../src/ui/TerminalButton.tsx");
    const { TContext } = await import("../src/i18n/context.tsx");
    render(
      <TContext.Provider value={store.i18n.t}>
        <TerminalButton
          store={store}
          hostId={h.hostId}
          target={{ cwd: h.repo, claudeSessionId: null }}
        />
      </TContext.Provider>,
    );
    await settle(() => options("Persona do Claude aqui").length > 1);
    return { store, ...h };
  }

  test("a host persona is chosen by its plain id", async () => {
    await open("host:qa");
    expect(select("Persona do Claude aqui")?.value).toBe("qa");
  });

  test("an app persona is not offered there, so none is chosen", async () => {
    await open("app:minha");
    expect(select("Persona do Claude aqui")?.value).toBe("");
  });
});

describe("clients-defaults: the snippets of the selected client", () => {
  async function open(selection: string | null) {
    const store = newStore();
    const h = await snippetsHost(cleanups, store);
    await h.save({ name: "a-primeiro", type: "command", run: "echo 1" });
    await h.save({ name: "b-do-acme", type: "command", run: "echo 2", tags: ["acme"] });
    await h.save({ name: "c-outro", type: "command", run: "echo 3", tags: ["x"] });
    const acme = addClient(store, "Acme", "/none", { snippetTag: "acme" });
    addClient(store, "Beta", "/none2");
    if (selection) store.setClientSelection(selection === "acme" ? acme : selection);
    render(<App store={store} />);
    await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
    });
    await settle(() => names().length === 3);
    return { store, ...h };
  }
  const names = () =>
    within(screen.queryByRole("list", { name: "Snippets" }) ?? document.body)
      .queryAllByRole("listitem")
      .map((r) => r.querySelector("[data-name]")?.textContent ?? "");

  test("the ones with the client's tag come first", async () => {
    await open("acme");
    expect(names()).toEqual(["b-do-acme", "a-primeiro", "c-outro"]);
  });

  test("with all clients selected the order is as before", async () => {
    await open(null);
    expect(names()).toEqual(["a-primeiro", "b-do-acme", "c-outro"]);
  });

  test("a new snippet starts with the client's tag", async () => {
    await open("acme");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Novo snippet" }) as HTMLElement);
    });
    expect(
      (screen.queryByLabelText("Etiquetas (separadas por vírgula)") as HTMLInputElement | null)
        ?.value,
    ).toBe("acme");
  });

  test("without a selected client a new snippet starts with no tag", async () => {
    await open(null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Novo snippet" }) as HTMLElement);
    });
    expect(
      (screen.queryByLabelText("Etiquetas (separadas por vírgula)") as HTMLInputElement | null)
        ?.value,
    ).toBe("");
  });
});

describe("clients-defaults: setting them on the Clients screen", () => {
  async function open() {
    const store = newStore();
    addClient(store, "Acme", "/none");
    render(<App store={store} />);
    const daemon = legacyDaemon(cleanups);
    daemon.features.push("personas");
    await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await act(async () => store.router.push({ name: "clients" }));
    await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
    return { store };
  }

  test("the snippet tag is saved with the persona, and cleared when emptied", async () => {
    const { store } = await open();
    const tag = screen.queryByLabelText("Tag dos snippets") as HTMLInputElement | null;
    expect(tag).not.toBeNull();
    await act(async () => {
      fireEvent.change(tag as HTMLElement, { target: { value: "acme" } });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Salvar padrões" }) as HTMLElement);
    });
    expect(store.clients.list()[0]?.defaults.snippetTag).toBe("acme");
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Tag dos snippets") as HTMLElement, {
        target: { value: "" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Salvar padrões" }) as HTMLElement);
    });
    expect(store.clients.list()[0]?.defaults.snippetTag).toBeUndefined();
  });

  test("the persona is offered from the hosts that keep personas", async () => {
    await open();
    expect(select("Persona padrão")).not.toBeNull();
  });
});
