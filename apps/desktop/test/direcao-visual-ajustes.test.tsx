import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { hostDotView } = await import("../src/lib/host-status.ts");
const { HostsBanner } = await import("../src/components/hosts/hosts-banner.tsx");
const { Timeline } = await import("../src/components/session/parts.tsx");

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

/** One host with a managed session "Alpha", a repository project and, optionally, a dead host. */
async function setup(
  options: { language?: string; deadHost?: boolean; projects?: number; waiting?: boolean } = {},
) {
  const d = makeDaemon(cleanups);
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Alpha" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  if (options.waiting) {
    d.manager.send(sessionId, "[bash]");
    await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
  }
  for (let i = 0; i < (options.projects ?? 0); i++) {
    const repo = join(d.root, `repo${i}`);
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "inicial");
    await d.board.addProject({ path: repo, promptTemplate: "" });
  }
  const mem = memoryPlatform(false, options.language ?? "pt-BR");
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    if (options.deadHost) {
      await store.addHost({ name: "longe", url: "ws://127.0.0.1:9", token: TOKEN });
    }
  });
  await settle(() => store.getState().hosts[0]?.sessions.length === 1);
  await sidebar.openHub();
  await settle(() => screen.queryByRole("listitem", { name: "Alpha" }) !== null);
  return { d, store, mem };
}

const main = () => screen.queryByRole("main") as HTMLElement;
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
const filtersButton = () => screen.queryByRole("button", { name: /^(Filtros|Filters)/ });

describe("direcao-visual: ajustes finos", () => {
  test("a lista traz só o campo Filtrar e um botão Filtros com o número de filtros ativos", async () => {
    await setup();
    expect(screen.queryByLabelText("Filtrar sessões")).not.toBeNull();
    // The four other controls live in a popover.
    for (const label of ["Host", "Origem", "Estado"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(filtersButton()?.textContent).toBe("Filtros");
    expect(filtersButton()?.querySelector("svg")).not.toBeNull();
    await click(filtersButton());
    for (const label of ["Host", "Origem", "Estado"]) {
      expect(screen.queryByLabelText(label)).not.toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Só fixadas" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mostrar arquivadas" })).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Estado") as HTMLElement, {
        target: { value: "ended" },
      });
    });
    await click(screen.queryByRole("button", { name: "Só fixadas" }));
    expect(filtersButton()?.textContent).toBe("Filtros2");
    expect(filtersButton()?.querySelector("[data-slot='badge']")?.textContent).toBe("2");
  });

  test("o título leva a linha: host e origem encolhem primeiro, somem abaixo de 320 px e o título inteiro vai no tooltip", async () => {
    await setup();
    const row = within(main()).queryByRole("listitem", { name: "Alpha" }) as HTMLElement;
    const meta = within(row).queryByText(/^alfa/);
    expect(meta?.className ?? "").toContain("shrink-[3]");
    expect(meta?.className ?? "").toContain("hidden");
    expect(meta?.className ?? "").toContain("@[20rem]:inline");
    // The list is the container the width is measured on.
    expect(main().querySelector("[class*='@container']")).not.toBeNull();
    const title = within(row).queryByRole("button", { name: "Alpha" });
    expect(title?.className ?? "").not.toContain("shrink-0");
    await act(async () => {
      fireEvent.focus(title as HTMLElement);
    });
    await settle(() => screen.queryByRole("tooltip") !== null);
    expect(screen.queryByRole("tooltip")?.textContent).toBe("Alpha");
  });

  test("hosts com problema viram uma linha compacta que expande ao clicar", async () => {
    await setup({ deadHost: true });
    await settle(
      () => within(main()).queryByRole("status", { name: "Hosts com problema" }) !== null,
    );
    const strip = within(main()).queryByRole("status", {
      name: "Hosts com problema",
    }) as HTMLElement;
    const toggle = within(strip).queryByRole("button", { name: "1 host com problema" });
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.querySelector("svg")).not.toBeNull();
    expect(within(strip).queryByText("longe")).toBeNull();
    await click(toggle);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(within(strip).queryByText("longe")).not.toBeNull();
  });

  test("a cor do host diz o estado: online azul, reconectando âmbar pulsando, offline cinza vazado, recusado e incompatível vermelhos", () => {
    expect(hostDotView("online")).toEqual({ tone: "running", hollow: false, pulse: false });
    expect(hostDotView("connecting")).toEqual({ tone: "needs-you", hollow: false, pulse: true });
    expect(hostDotView("offline")).toEqual({ tone: "idle", hollow: true, pulse: false });
    expect(hostDotView("unauthorized")).toEqual({ tone: "error", hollow: false, pulse: false });
    expect(hostDotView("incompatible")).toEqual({ tone: "error", hollow: false, pulse: false });
  });

  test("Board e Workflows vão cada um à sua tela: o projeto único abre direto, vários pedem a escolha", async () => {
    const { store } = await setup({ projects: 1 });
    await click(screen.queryByRole("button", { name: "Board" }));
    await settle(() => store.router.current.name === "board");
    expect(store.router.current.name).toBe("board");
    await click(screen.queryByRole("button", { name: "Workflows" }));
    await settle(() => store.router.current.name === "workflows");
    expect(store.router.current.name).toBe("workflows");
    cleanup();
    const { store: store2 } = await setup({ projects: 2 });
    await click(screen.queryByRole("button", { name: "Board" }));
    await settle(() => screen.queryByRole("heading", { name: "Board de alfa" }) !== null);
    expect(screen.queryByRole("heading", { name: "Board de alfa" })).not.toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Abrir board de/ })).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: /^Workflows de/ })).toHaveLength(0);
    await click(screen.queryByRole("button", { name: "Workflows" }));
    await settle(() => screen.queryByRole("heading", { name: "Workflows de alfa" }) !== null);
    expect(screen.queryAllByRole("button", { name: /^Workflows de/ })).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: /^Abrir board de/ })).toHaveLength(0);
    // Each project opens the screen asked for.
    await click(screen.queryAllByRole("button", { name: /^Workflows de repo/ })[0] ?? null);
    expect(store2.router.current.name).toBe("workflows");
    await click(screen.queryByRole("button", { name: "Board" }));
    await settle(() => screen.queryByRole("heading", { name: "Board de alfa" }) !== null);
    await click(screen.queryAllByRole("button", { name: /^Abrir board de/ })[0] ?? null);
    expect(store2.router.current.name).toBe("board");
  });

  test("em inglês, a lista inteira fala inglês: filtros, estados, menu e títulos", async () => {
    await setup({ language: "en" });
    const list = main();
    expect(within(list).queryByLabelText("Filter sessions")).not.toBeNull();
    expect(filtersButton()?.textContent).toBe("Filters");
    await click(filtersButton());
    expect(screen.queryByLabelText("Host")).not.toBeNull();
    for (const label of ["Origin", "State"]) expect(screen.queryByLabelText(label)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Pinned only" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show archived" })).not.toBeNull();
    const options = [...(screen.queryByLabelText("State")?.querySelectorAll("option") ?? [])].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["All states", "Running", "Needs you", "Idle", "Ended"]);
    expect(within(list).queryByRole("img", { name: "idle" })).not.toBeNull();
    expect(within(list).queryByRole("button", { name: "Actions of Alpha" })).not.toBeNull();
    expect(list.textContent ?? "").not.toMatch(
      /Filtrar|Todos os|Só fixadas|arquivadas|Ações|ociosa/,
    );
  });

  test("a largura da lista fica guardada e volta na próxima abertura", async () => {
    const { mem } = await setup();
    const separator = () => screen.queryByRole("separator", { name: "Redimensionar a lista" });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("380");
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.keyDown(separator() as HTMLElement, { key: "ArrowRight" });
      });
    }
    expect(separator()?.getAttribute("aria-valuenow")).toBe("412");
    expect(mem.platform.storage.getItem("flightdeck.listWidth")).toBe("412");
    cleanup();
    const again = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    render(<App store={again} />);
    await settle(() => separator() !== null);
    expect(separator()?.getAttribute("aria-valuenow")).toBe("412");
    // Nonsense in the storage falls back to the default.
    mem.platform.storage.setItem("flightdeck.listWidth", "abc");
    expect(new AppStore(mem.platform).listWidth()).toBe(380);
    mem.platform.storage.setItem("flightdeck.listWidth", "9999");
    expect(new AppStore(mem.platform).listWidth()).toBe(640);
  });

  test("reconectando também aparece na linha de hosts com problema, quando aberta", () => {
    const store = new AppStore(memoryPlatform().platform);
    cleanups.push(() => store.dispose());
    const host = (id: string, status: string) => ({ id, name: id, status }) as never;
    render(
      <HostsBanner
        hosts={[host("volta", "connecting"), host("caiu", "offline")]}
        t={store.i18n.t}
      />,
    );
    const toggle = screen.queryByRole("button", { name: "2 hosts com problema" });
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLElement);
    expect(screen.queryByText("1 host reconectando")).not.toBeNull();
    expect(screen.queryByText("1 host offline")).not.toBeNull();
  });

  test("a escolha de Board e Workflows mostra o carregamento e, sem projetos, o estado vazio", async () => {
    const { store } = await setup({ projects: 0 });
    const hostId = store.getState().hosts[0]?.id ?? "";
    await act(async () => {
      store.router.push({ name: "projects", host: hostId, focus: "board" });
    });
    expect(screen.queryByRole("status", { name: "Carregando projetos" })).not.toBeNull();
    await settle(() => screen.queryByText("Nenhum projeto cadastrado.") !== null);
    expect(screen.queryByText("Nenhum projeto cadastrado.")).not.toBeNull();
  });

  test("a largura da lista também é guardada em Precisa de você e no Histórico", async () => {
    const { store, mem } = await setup({ waiting: true });
    const separator = () => screen.queryByRole("separator", { name: /Redimensionar a lista/ });
    const widen = async () => {
      await act(async () => {
        fireEvent.keyDown(separator() as HTMLElement, { key: "ArrowRight" });
      });
    };
    await act(async () => {
      store.router.push({ name: "history", host: store.getState().hosts[0]?.id ?? "" });
    });
    await settle(() => separator() !== null);
    await widen();
    expect(mem.platform.storage.getItem("flightdeck.listWidth")).toBe("396");
    await sidebar.openQueue();
    await settle(() => separator() !== null);
    await widen();
    expect(mem.platform.storage.getItem("flightdeck.listWidth")).toBe("412");
  });

  test("as regiões que rolam (a conversa e as colunas do board) pegam foco: acesso pelo teclado", async () => {
    render(
      <Timeline role="log" aria-label="Conversa">
        <p>oi</p>
      </Timeline>,
    );
    expect(screen.queryByRole("log", { name: "Conversa" })?.getAttribute("tabindex")).toBe("0");
    cleanup();
    const { store } = await setup({ projects: 1 });
    await click(screen.queryByRole("button", { name: "Board" }));
    await settle(() => store.router.current.name === "board");
    await settle(() => document.querySelector("[class*='grid-flow-col']") !== null);
    expect(document.querySelector("[class*='grid-flow-col']")?.getAttribute("tabindex")).toBe("0");
  });

  test("o caminho de um board aberto direto traz o nome do projeto, não o id", async () => {
    const { store } = await setup({ projects: 1 });
    const hostId = store.getState().hosts[0]?.id ?? "";
    const project = (await store.hostCommand(hostId, "project.list", {}))?.projects[0];
    expect(project?.name).toBe("repo0");
    // A fresh state: the projects list was never opened.
    expect(store.getState().projects[hostId]).toBeUndefined();
    await act(async () => {
      store.router.push({ name: "board", host: hostId, projectId: project?.id ?? "" });
    });
    const path = () => screen.queryByRole("navigation", { name: "Você está em" })?.textContent;
    await settle(() => path() === "alfaBoardrepo0");
    expect(path()).toBe("alfaBoardrepo0");
  });

  test("o board tem um botão Novo card que abre um diálogo; o formulário fixo saiu do cabeçalho", async () => {
    const { store } = await setup({ projects: 1 });
    await click(screen.queryByRole("button", { name: "Board" }));
    await settle(() => store.router.current.name === "board");
    await settle(() => screen.queryByRole("button", { name: "Novo card" }) !== null);
    expect(screen.queryByLabelText("Título do card")).toBeNull();
    expect(screen.queryByLabelText("Descrição do card")).toBeNull();
    // Cancelar leaves nothing behind.
    await click(screen.queryByRole("button", { name: "Novo card" }));
    const dialog = () => screen.queryByRole("dialog", { name: "Novo card" });
    expect(dialog()).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Título do card") as HTMLElement, {
        target: { value: "Rascunho" },
      });
    });
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Cancelar" }));
    expect(dialog()).toBeNull();
    expect(screen.queryByLabelText("Card Rascunho")).toBeNull();
    // Criar adds the card and closes the dialog; a new one opens empty.
    await click(screen.queryByRole("button", { name: "Novo card" }));
    expect((screen.queryByLabelText("Título do card") as HTMLInputElement).value).toBe("");
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Título do card") as HTMLElement, {
        target: { value: "Do diálogo" },
      });
    });
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Criar card" }));
    await settle(() => screen.queryByLabelText("Card Do diálogo") !== null);
    expect(screen.queryByLabelText("Card Do diálogo")).not.toBeNull();
    expect(dialog()).toBeNull();
  });
});
