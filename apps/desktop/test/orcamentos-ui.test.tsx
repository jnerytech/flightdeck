import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Budgets } from "../../daemon/src/costs/budgets.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

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

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const choose = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | HTMLSelectElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);
let seq = 0;

/** A daemon with costs and budgets on a fixed day, US$ 6 spent on it, and the app on it. */
async function online(withSpend = true) {
  let budgets: Budgets | null = null;
  const d = makeDaemon(cleanups, {
    costs: true,
    budgets: (db) => {
      budgets = new Budgets({ db, now: () => START, day: () => TODAY });
      return budgets;
    },
  });
  const spend = (cost: number, key = "kA") =>
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, ?, ?, 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      )
      .run(`b${++seq}`, `${TODAY}T12:00:00.000Z`, TODAY, key, cost);
  if (withSpend) spend(6);
  const server = d.listen();
  const mem = memoryPlatform(false);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null);
  return { d, mem, store, spend, budgets: budgets as unknown as Budgets };
}

const section = () => screen.queryByRole("region", { name: "Orçamentos de alfa" });
const rows = () =>
  [...(section()?.querySelectorAll("li [data-row-title]") ?? [])].map((title) => title.textContent);
const form = () => section()?.querySelector("form") as HTMLFormElement;
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
const saveButton = (name = "Criar orçamento") =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const projectOptions = () =>
  [...((field("Projeto do orçamento") as HTMLSelectElement).options ?? [])].map((o) => o.text);

describe("orcamentos-ui", () => {
  test("criar, editar e remover orçamento, com o percentual atual", async () => {
    await online();
    await click("Configurações");
    await settle(() => section() !== null);
    expect(section()).not.toBeNull();
    await choose("Limite (US$)", "10");
    await click("Criar orçamento");
    await settle(() => rows().length === 1);
    expect(rows()).toEqual(["orçamento do host (dia) · notificar · US$ 6.00 de US$ 10.00 (60%)"]);
    await click("Editar orçamento do host (dia)");
    await choose("Limite (US$)", "20");
    await choose("Ao passar do limite", "queue");
    await click("Salvar orçamento");
    await settle(() => rows()[0]?.includes("(30%)") === true);
    expect(rows()).toEqual([
      "orçamento do host (dia) · segurar cards novos · US$ 6.00 de US$ 20.00 (30%)",
    ]);
    await choose("Escopo", "project");
    await settle(() => projectOptions().includes("kA"));
    await choose("Projeto do orçamento", "kA");
    await choose("Período", "month");
    await choose("Limite (US$)", "100");
    await click("Criar orçamento");
    await settle(() => rows().length === 2);
    expect(rows()[1]).toBe("orçamento de kA (mês) · notificar · US$ 6.00 de US$ 100.00 (6%)");
    await click("Remover orçamento do host (dia)");
    // The confirmation comes first: Cancelar removes nothing.
    await click("Cancelar");
    expect(rows()).toHaveLength(2);
    await click("Remover orçamento do host (dia)");
    await click("Remover orçamento");
    await settle(() => rows().length === 1);
    expect(rows()).toEqual(["orçamento de kA (mês) · notificar · US$ 6.00 de US$ 100.00 (6%)"]);
  });

  test("o formulário tem rótulos, diz o que cada ação faz e só salva com um limite", async () => {
    await online();
    await click("Configurações");
    await settle(() => section() !== null);
    expect(form().getAttribute("aria-label")).toBe("Novo orçamento");
    for (const label of ["Escopo", "Período", "Limite (US$)", "Ao passar do limite"]) {
      expect(field(label).labels?.length).toBe(1);
    }
    const action = field("Ao passar do limite");
    const help = () => document.getElementById(action.getAttribute("aria-describedby") ?? "");
    expect(help()?.textContent).toBe("Avisa ao chegar a 50%, 80% e 100% do limite.");
    await choose("Ao passar do limite", "queue");
    expect(help()?.textContent).toBe(
      "Avisa e segura os cards novos do escopo ao chegar a 100% do limite.",
    );
    expect(saveButton().disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText("Informe um limite maior que zero."),
    ).not.toBeNull();
    await choose("Limite (US$)", "0");
    expect(saveButton().disabled).toBe(true);
    await choose("Limite (US$)", "10");
    expect(saveButton().disabled).toBe(false);
    expect(
      within(section() as HTMLElement).queryByText("Informe um limite maior que zero."),
    ).toBeNull();
    await choose("Escopo", "project");
    expect(saveButton().disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText("Informe o projeto do orçamento."),
    ).not.toBeNull();
  });

  test("Enter no limite salva o orçamento", async () => {
    await online();
    await click("Configurações");
    await settle(() => section() !== null);
    expect(saveButton().type).toBe("submit");
    await choose("Limite (US$)", "10");
    await act(async () => {
      fireEvent.submit(form());
    });
    await settle(() => rows().length === 1);
    expect(rows()).toHaveLength(1);
    expect((field("Limite (US$)") as HTMLInputElement).value).toBe("");
  });

  test("sem orçamentos diz Nenhum orçamento; editar abre o formulário com Cancelar", async () => {
    await online();
    await click("Configurações");
    await settle(() => section() !== null);
    expect(within(section() as HTMLElement).queryByText("Nenhum orçamento ainda.")).not.toBeNull();
    await choose("Limite (US$)", "10");
    await click("Criar orçamento");
    await settle(() => rows().length === 1);
    expect(within(section() as HTMLElement).queryByText("Nenhum orçamento ainda.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar edição" })).toBeNull();
    await click("Editar orçamento do host (dia)");
    expect(form().getAttribute("aria-label")).toBe("Editar orçamento do host (dia)");
    expect((field("Limite (US$)") as HTMLInputElement).value).toBe("10");
    await click("Cancelar edição");
    expect(form().getAttribute("aria-label")).toBe("Novo orçamento");
    expect((field("Limite (US$)") as HTMLInputElement).value).toBe("");
    expect(rows()).toHaveLength(1);
  });

  test("um orçamento de projeto mostra o nome do projeto e deixa o caminho inteiro no title", async () => {
    const { spend } = await online();
    spend(1, "/srv/work/flightdeck-web");
    await click("Configurações");
    await settle(() => section() !== null);
    await choose("Escopo", "project");
    await settle(() => projectOptions().includes("flightdeck-web"));
    await choose("Projeto do orçamento", "/srv/work/flightdeck-web");
    await choose("Limite (US$)", "10");
    await click("Criar orçamento");
    await settle(() => rows().length === 1);
    expect(rows()).toEqual([
      "orçamento de flightdeck-web (dia) · notificar · US$ 0.00 de US$ 10.00 (0%)",
    ]);
    const title = section()?.querySelector("li [data-row-title] span") as HTMLElement;
    expect(title.title).toBe("/srv/work/flightdeck-web");
    await click("Editar orçamento de flightdeck-web (dia)");
    expect((field("Projeto do orçamento") as HTMLInputElement).value).toBe(
      "/srv/work/flightdeck-web",
    );
  });

  test("o projeto do orçamento é uma lista dos projetos conhecidos, com o nome por rótulo e a chave por valor", async () => {
    const { spend } = await online();
    spend(1, "github.com/acme/app");
    spend(1, "github.com/acme/web");
    await click("Configurações");
    await settle(() => section() !== null);
    await choose("Escopo", "project");
    await settle(() => projectOptions().length > 1);
    expect(projectOptions()).toEqual(["Escolha um projeto", "app", "kA", "web"]);
    expect(saveButton().disabled).toBe(true);
    await choose("Limite (US$)", "10");
    expect(saveButton().disabled).toBe(true);
    expect(
      within(section() as HTMLElement).queryByText("Informe o projeto do orçamento."),
    ).not.toBeNull();
    await choose("Projeto do orçamento", "github.com/acme/web");
    await click("Criar orçamento");
    await settle(() => rows().length === 1);
    expect(rows()[0]).toContain("orçamento de web (dia)");
  });

  test("dois projetos com o mesmo nome mostram a chave ao lado do nome", async () => {
    const { spend } = await online();
    spend(1, "github.com/acme/app");
    spend(1, "github.com/other/app");
    await click("Configurações");
    await settle(() => section() !== null);
    await choose("Escopo", "project");
    await settle(() => projectOptions().length > 1);
    expect(projectOptions()).toEqual([
      "Escolha um projeto",
      "app · github.com/acme/app",
      "app · github.com/other/app",
      "kA",
    ]);
  });

  test("sem projetos conhecidos o projeto é um campo de texto", async () => {
    await online(false);
    await click("Configurações");
    await settle(() => section() !== null);
    await choose("Escopo", "project");
    await act(() => Bun.sleep(100));
    const project = field("Projeto do orçamento");
    expect(project.tagName).toBe("INPUT");
  });

  test("o botão diz Criar num orçamento novo e Salvar ao editar um", async () => {
    await online();
    await click("Configurações");
    await settle(() => section() !== null);
    expect(screen.queryByRole("button", { name: "Salvar orçamento" })).toBeNull();
    await choose("Limite (US$)", "10");
    await click("Criar orçamento");
    await settle(() => rows().length === 1);
    await click("Editar orçamento do host (dia)");
    expect(screen.queryByRole("button", { name: "Criar orçamento" })).toBeNull();
    expect(saveButton("Salvar orçamento")).not.toBeNull();
  });

  test("limiar cruzado notifica e aparece em Precisa de você; o alerta abre os orçamentos", async () => {
    const { mem, spend, budgets } = await online();
    await act(async () => {
      budgets.set({ scope: "host", period: "day", limitUsd: 10, action: "notify" });
    });
    await settle(() => mem.notifications.length > 0);
    expect(mem.notifications).toEqual([
      { title: "Orçamento", body: "alfa: orçamento do host (dia) em 50% de US$ 10.00" },
    ]);
    const alert = "alfa · orçamento do host (dia): 60% de US$ 10.00";
    await sidebar.openQueue();
    await settle(() => screen.queryByRole("button", { name: alert }) !== null);
    expect(screen.queryByRole("heading", { name: "Precisa de você" })).not.toBeNull();
    spend(3);
    await act(async () => budgets.evaluate());
    await settle(() => mem.notifications.length > 1);
    expect(mem.notifications[1]?.body).toBe("alfa: orçamento do host (dia) em 80% de US$ 10.00");
    await sidebar.queueItem("alfa · orçamento do host (dia): 90% de US$ 10.00");
    await settle(() => section() !== null);
    expect(section()).not.toBeNull();
  });

  test("a notificação de um orçamento de projeto diz o nome do projeto, não a chave", async () => {
    const { mem, spend, budgets } = await online();
    spend(6, "github.com/acme/repo");
    await act(async () => {
      budgets.set({
        scope: "project",
        projectKey: "github.com/acme/repo",
        period: "day",
        limitUsd: 10,
        action: "notify",
      });
    });
    await settle(() => mem.notifications.length > 0);
    expect(mem.notifications).toEqual([
      { title: "Orçamento", body: "alfa: orçamento de repo (dia) em 50% de US$ 10.00" },
    ]);
  });

  test("host sem costs: sem orçamentos e sem banner de erro", async () => {
    const legacy = legacyDaemon(cleanups);
    const mem = memoryPlatform(false);
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000, now: () => START });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: legacy.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    await act(() => Bun.sleep(50));
    await click("Configurações");
    expect(section()).toBeNull();
    expect(legacy.asked.some((t) => t === "budget.list")).toBe(false);
    expect(store.getState().error).toBeNull();
  });
});
