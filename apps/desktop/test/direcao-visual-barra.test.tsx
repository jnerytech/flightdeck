import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { hubRows } = await import("../src/lib/hub.ts");
const { App } = await import("../src/ui/App.tsx");
const { SplitView } = await import("../src/components/layout/split-view.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

/** One host with a managed session; `waiting` leaves it asking for Bash. */
async function setup(options: { waiting?: boolean; costs?: boolean } = {}) {
  const d = makeDaemon(cleanups, { costs: options.costs ?? false });
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Gerenciada" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  if (options.waiting) {
    d.manager.send(sessionId, "[bash]");
    await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
  }
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => store.getState().hosts[0]?.sessions.length === 1);
  return { d, store, sessionId };
}

const aside = () => screen.queryByRole("complementary", { name: "Barra lateral" }) as HTMLElement;
const inAside = () => within(aside());
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
/** A Radix menu opens on pointer down. */
async function openHostMenu() {
  const trigger = inAside().queryByRole("button", { name: "Menu de alfa" });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, { button: 0, ctrlKey: false });
    fireEvent.click(trigger as HTMLElement);
  });
}
const choose = async (name: string) => {
  await openHostMenu();
  await click(screen.queryByRole("menuitem", { name }));
};

describe("direcao-visual: barra lateral", () => {
  test("logo e nome, navegação com ícones na ordem do desenho e rodapé", async () => {
    await setup({ costs: true });
    expect(inAside().queryByText("Flightdeck")).not.toBeNull();
    expect(aside().querySelector("img, svg[data-logo]")).not.toBeNull();
    const nav = aside().querySelector("nav") as HTMLElement;
    const items = [...nav.querySelectorAll("button")];
    expect(items.map((b) => b.textContent?.replace(/\d+$/, ""))).toEqual([
      "Sessões",
      "Precisa de você",
      "Board",
      "Workflows",
      "Custos",
      // The vault is the app's (phase 16), so Cofre shows whatever the hosts offer.
      "Cofre",
      "Histórico",
    ]);
    for (const item of items) expect(item.querySelector("svg")).not.toBeNull();
    // Search with its shortcut, settings and the theme button close the bar.
    const search = inAside().queryByRole("button", { name: "Buscar no histórico (Ctrl+K)" });
    expect(search?.querySelector("kbd")?.textContent).toBe("Ctrl K");
    expect(inAside().queryByRole("button", { name: "Configurações" })).not.toBeNull();
    expect(inAside().queryByRole("button", { name: "Alternar tema" })).not.toBeNull();
  });

  test("o contador de Precisa de você só aparece quando há pedidos", async () => {
    await setup();
    const needs = () => inAside().queryByRole("button", { name: /^Precisa de você/ });
    expect(needs()?.textContent).toBe("Precisa de você");
    cleanup();
    await setup({ waiting: true });
    await settle(() => (needs()?.textContent ?? "") !== "Precisa de você");
    expect(needs()?.textContent).toBe("Precisa de você1");
    expect(needs()?.querySelector("[data-slot='badge']")?.textContent).toBe("1");
  });

  test("cada item da navegação abre a sua tela", async () => {
    const { store } = await setup({ costs: true });
    const go = async (name: string) => {
      await click(inAside().queryByRole("button", { name }));
      // Board and Workflows ask the host for its projects first.
      await act(() => Bun.sleep(40));
      return store.router.current.name;
    };
    expect(await go("Precisa de você")).toBe("needs-you");
    expect(await go("Custos")).toBe("costs");
    expect(await go("Histórico")).toBe("history");
    expect(await go("Board")).toBe("projects");
    expect(await go("Workflows")).toBe("projects");
    expect(await go("Abrir Sessões")).toBe("hub");
    expect(await go("Configurações")).toBe("settings");
  });

  test("Hosts recolhe; cada host tem pontinho de estado, nome e menu", async () => {
    const { store } = await setup();
    const section = inAside().queryByRole("button", { name: "Hosts" });
    expect(section?.getAttribute("aria-expanded")).toBe("true");
    expect(inAside().queryByRole("img", { name: "alfa: online" })?.className ?? "").toContain(
      "bg-status-running",
    );
    expect(inAside().queryByRole("button", { name: "Abrir host alfa" })?.textContent).toBe("alfa");
    await click(inAside().queryByRole("button", { name: "Abrir host alfa" }));
    expect(store.router.current.name).toBe("host");

    await openHostMenu();
    expect(screen.queryAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Abrir em nova aba",
      "Histórico",
      "Projetos",
      "Nova sessão",
      "Remover host",
    ]);
    await act(async () => {
      fireEvent.keyDown(screen.queryAllByRole("menuitem")[0] as HTMLElement, { key: "Escape" });
    });
    await choose("Histórico");
    expect(store.router.current.name).toBe("history");
    await choose("Projetos");
    expect(store.router.current.name).toBe("projects");
    await choose("Nova sessão");
    expect(store.router.current.name).toBe("new-session");

    await click(inAside().queryByRole("button", { name: "Adicionar outro host" }));
    expect(store.router.current.name).toBe("add-host");
    await click(section);
    expect(section?.getAttribute("aria-expanded")).toBe("false");
    expect(inAside().queryByRole("button", { name: "Abrir host alfa" })).toBeNull();
  });

  test("Fixadas lista as sessões fixadas; sem nenhuma, a seção não aparece", async () => {
    const { store } = await setup();
    expect(inAside().queryByRole("button", { name: "Fixadas" })).toBeNull();
    const row = hubRows(store.getState()).find((r) => r.title === "Gerenciada");
    await act(async () => {
      await store.setMeta(row?.hostId as string, row?.claudeSessionId as string, { pinned: true });
    });
    await settle(() => inAside().queryByRole("button", { name: "Fixadas" }) !== null);
    expect(inAside().queryByRole("button", { name: "Fixadas" })).not.toBeNull();
    // The section folds, and unfolds.
    const section = inAside().queryByRole("button", { name: "Fixadas" });
    expect(section?.getAttribute("aria-expanded")).toBe("true");
    await click(section);
    expect(section?.getAttribute("aria-expanded")).toBe("false");
    expect(inAside().queryByRole("button", { name: "Gerenciada" })).toBeNull();
    await click(section);
    await click(inAside().queryByRole("button", { name: "Gerenciada" }));
    expect(store.router.current.name).toBe("session");
  });

  test("rodapé: a busca abre a paleta e o botão de tema troca o tema", async () => {
    const { store } = await setup();
    await click(inAside().queryByRole("button", { name: "Buscar no histórico (Ctrl+K)" }));
    expect(store.getState().searchOpen).toBe(true);
    const before = store.theme.resolved;
    await click(inAside().queryByRole("button", { name: "Alternar tema" }));
    expect(store.theme.resolved).not.toBe(before);
  });

  test("recolhida (56 px), a barra guarda só ícones, com os mesmos nomes acessíveis", async () => {
    const { store } = await setup({ waiting: true });
    await click(screen.queryByRole("button", { name: "Recolher barra lateral" }));
    expect(aside().getAttribute("data-collapsed")).toBe("true");
    // No visible words: the names move to the buttons' labels and tooltips.
    expect(aside().textContent).not.toContain("Sessões");
    expect(aside().textContent).not.toContain("Hosts");
    expect(inAside().queryByRole("button", { name: "Abrir Sessões" })?.getAttribute("title")).toBe(
      "Sessões",
    );
    expect(inAside().queryByRole("button", { name: /^Precisa de você/ })).not.toBeNull();
    expect(inAside().queryByRole("button", { name: "Configurações" })).not.toBeNull();
    // A host is just its dot, which still opens the host.
    await click(inAside().queryByRole("button", { name: "Abrir host alfa" }));
    expect(store.router.current.name).toBe("host");
    expect(inAside().queryByRole("button", { name: "Menu de alfa" })).toBeNull();
  });
});

describe("direcao-visual: lista e detalhe", () => {
  const view = (onClose = () => {}, detail: string | null = "detalhe") =>
    render(
      <SplitView
        list={<p>lista</p>}
        detail={detail === null ? null : <p>{detail}</p>}
        empty={<p>nada aberto</p>}
        onClose={onClose}
        labels={{ resize: "Redimensionar a lista", back: "Voltar à lista" }}
      />,
    );
  const separator = () => screen.queryByRole("separator", { name: "Redimensionar a lista" });
  const cols = () => screen.queryByRole("group")?.style.gridTemplateColumns;

  test("a lista tem ~380 px e o detalhe fica à direita; sem detalhe, mostra o estado vazio", () => {
    view();
    expect(cols()).toBe("380px 1px minmax(0, 1fr)");
    expect(screen.queryByText("lista")).not.toBeNull();
    expect(screen.queryByText("detalhe")).not.toBeNull();
    expect(screen.queryByText("nada aberto")).toBeNull();
    cleanup();
    view(() => {}, null);
    expect(screen.queryByText("nada aberto")).not.toBeNull();
  });

  test("o divisor redimensiona a lista pelo teclado e pelo mouse, entre 280 e 640 px", async () => {
    view();
    expect(separator()).not.toBeNull();
    expect(separator()?.getAttribute("aria-valuenow")).toBe("380");
    expect(separator()?.getAttribute("aria-valuemin")).toBe("280");
    expect(separator()?.getAttribute("aria-valuemax")).toBe("640");
    await act(async () => {
      fireEvent.keyDown((separator() ?? window) as HTMLElement, { key: "ArrowRight" });
    });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("396");
    await act(async () => {
      fireEvent.keyDown((separator() ?? window) as HTMLElement, { key: "ArrowLeft" });
      fireEvent.keyDown((separator() ?? window) as HTMLElement, { key: "ArrowLeft" });
    });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("364");
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        fireEvent.keyDown((separator() ?? window) as HTMLElement, { key: "ArrowLeft" });
      });
    }
    expect(separator()?.getAttribute("aria-valuenow")).toBe("280");
    // Dragging follows the pointer from where it started.
    await act(async () => {
      fireEvent.pointerDown((separator() ?? window) as HTMLElement, { clientX: 280, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 400, pointerId: 1 });
    });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("400");
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 5000, pointerId: 1 });
    });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("640");
    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("640");
  });

  test("Esc fecha o detalhe, mas não o que outro componente já tratou", async () => {
    const closed: string[] = [];
    view(() => closed.push("fechou"));
    expect(screen.queryByText("detalhe")).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown((screen.queryByText("detalhe") ?? window) as HTMLElement, {
        key: "Escape",
      });
    });
    expect(closed).toEqual(["fechou"]);
    await act(async () => {
      fireEvent.keyDown((screen.queryByText("lista") ?? window) as HTMLElement, { key: "a" });
    });
    expect(closed).toEqual(["fechou"]);
  });
});

describe("direcao-visual: Precisa de você", () => {
  const rowName = "alfa · Gerenciada: Bash";

  test("sem pedidos, o estado vazio tem um ícone grande, uma frase e uma ação", async () => {
    const { store } = await setup();
    await click(inAside().queryByRole("button", { name: /^Precisa de você/ }));
    expect(store.router.current.name).toBe("needs-you");
    const main = screen.queryByRole("main") as HTMLElement;
    expect(within(main).queryByRole("heading", { name: "Precisa de você" })).not.toBeNull();
    expect(within(main).queryByText("Nada espera por você.")).not.toBeNull();
    expect(main.querySelector("svg[class*='size-10']")).not.toBeNull();
    await click(within(main).queryByRole("button", { name: "Ver as sessões" }));
    expect(store.router.current.name).toBe("hub");
  });

  test("a lista à esquerda e, ao escolher um pedido, o cartão à direita; Esc fecha", async () => {
    const { d, sessionId, store } = await setup({ waiting: true });
    await settle(() => store.getState().hosts[0]?.sessions[0]?.status === "awaiting_permission");
    await click(inAside().queryByRole("button", { name: /^Precisa de você/ }));
    const main = screen.queryByRole("main") as HTMLElement;
    // Nothing chosen yet: the right side says what to do.
    expect(within(main).queryByText("Escolha um pedido para ver os detalhes.")).not.toBeNull();
    expect(within(main).queryByRole("group", { name: "Pedido de Bash" })).toBeNull();
    const row = within(main).queryByRole("button", { name: rowName });
    expect(row?.getAttribute("aria-pressed")).toBe("false");
    await click(row);
    expect(row?.getAttribute("aria-pressed")).toBe("true");
    expect(within(main).queryByRole("group", { name: "Pedido de Bash" })).not.toBeNull();
    expect(within(main).queryByRole("button", { name: "Abrir sessão" })).not.toBeNull();
    // Esc closes the detail and the list stays.
    await act(async () => {
      fireEvent.keyDown(within(main).queryByRole("group", { name: "Pedido de Bash" }) as Element, {
        key: "Escape",
      });
    });
    expect(within(main).queryByRole("group", { name: "Pedido de Bash" })).toBeNull();
    expect(within(main).queryByRole("button", { name: rowName })).not.toBeNull();
    // Choosing again and approving answers the daemon.
    await click(within(main).queryByRole("button", { name: rowName }));
    await click(within(main).queryByRole("button", { name: "Aprovar" }));
    await poll(() => d.manager.pendingPermissions(sessionId).length === 0);
    // The session goes on to open from the detail.
    await settle(() => within(main).queryByRole("button", { name: rowName }) === null);
    expect(within(main).queryByText("Nada espera por você.")).not.toBeNull();
  });

  test("J e K movem a escolha e Enter mostra o detalhe", async () => {
    const { store } = await setup({ waiting: true });
    await settle(() => store.getState().hosts[0]?.sessions[0]?.status === "awaiting_permission");
    await click(inAside().queryByRole("button", { name: /^Precisa de você/ }));
    const main = screen.queryByRole("main") as HTMLElement;
    const row = () => within(main).queryByRole("button", { name: rowName });
    await act(async () => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(row()?.getAttribute("data-active")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(within(main).queryByRole("group", { name: "Pedido de Bash" })).not.toBeNull();
  });
});
