import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { projectLabel } = await import("../src/lib/costs.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

const main = () => screen.queryByRole("main") as HTMLElement;
const text = () => main()?.textContent ?? "";

/** An app with a host that announces `costs` (or not), the Custos screen already asked for. */
async function setup(options: { costs: boolean; routeFirst?: boolean }) {
  const d = makeDaemon(cleanups, { costs: options.costs });
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  if (options.routeFirst) {
    await act(async () => {
      store.router.push({ name: "costs" });
    });
  }
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  // `host.info` (the features) lands after the host turns online; the screen needs it to pick a host.
  await settle(() => {
    const host = store.getState().hosts[0];
    return host?.status === "online" && Boolean(host.hostInfo);
  });
  if (!options.routeFirst) {
    await act(async () => {
      store.router.push({ name: "costs" });
    });
  }
  return { store };
}

describe("custos-ui: a tela nunca fica em branco", () => {
  test("enquanto os totais chegam, mostra o carregamento", async () => {
    await setup({ costs: true });
    expect(screen.queryByRole("status", { name: "Carregando custos" })).not.toBeNull();
  });

  test("sem uso no período, mostra o estado vazio com a ação de ver 30 dias", async () => {
    await setup({ costs: true });
    await settle(() => text().includes("Nenhum custo neste período"));
    expect(text()).toContain("Nenhum custo neste período");
    const more = within(main()).queryByRole("button", { name: "Ver os últimos 30 dias" });
    expect(more).not.toBeNull();
    await act(async () => {
      fireEvent.click(more as HTMLElement);
    });
    expect(
      within(main()).queryByRole("button", { name: "30 dias" })?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("aberta antes de o host conectar, a tela carrega quando ele conecta", async () => {
    await setup({ costs: true, routeFirst: true });
    await settle(() => text().includes("Nenhum custo neste período"));
    expect(text()).toContain("Nenhum custo neste período");
  });

  test("sem host que informe custos, a tela diz isso em vez de ficar em branco", async () => {
    const { store } = await setup({ costs: false });
    await settle(() => text().includes("Nenhum host informa custos"));
    expect(text()).toContain("Nenhum host informa custos ainda.");
    expect(within(main()).queryByRole("heading", { name: "Custos" })).not.toBeNull();
    const link = within(main()).queryByRole("button", { name: "Adicionar host" });
    expect(link).not.toBeNull();
    await act(async () => {
      fireEvent.click(link as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "add-host" });
  });

  test("o projeto de um custo aparece pelo nome da pasta, sem o host nem o caminho", () => {
    expect(projectLabel("host:alfa:C:\\Users\\dev\\flightdeck-web")).toBe("flightdeck-web");
    expect(projectLabel("host:beta:/home/dev/work/api-gateway")).toBe("api-gateway");
    expect(projectLabel("github.com/acme/central")).toBe("github.com/acme/central");
  });
});
