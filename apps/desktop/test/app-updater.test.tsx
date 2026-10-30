import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, NOTIFY_UPDATES_KEY } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";

/** Web platform with a fake updater: `available` is what `check` finds; `install` may fail. */
function setup(
  opts: { available?: { version: string; notes: string } | null; installError?: string } = {},
) {
  const mem = memoryPlatform();
  const calls: string[] = [];
  mem.platform.updater = {
    supported: true,
    check: async () => {
      calls.push("check");
      return opts.available ?? null;
    },
    install: async () => {
      calls.push("install");
      if (opts.installError) throw new Error(opts.installError);
    },
  };
  return { ...mem, calls };
}

async function start(mem: ReturnType<typeof setup>) {
  const store = new AppStore(mem.platform);
  cleanups.push(() => store.dispose());
  // The App runs init() itself on mount.
  render(<App store={store} />);
  await act(async () => {
    await Bun.sleep(0);
  });
  return store;
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("app-updater", () => {
  test("ao abrir, uma versão nova aparece na faixa com as notas; Instalar chama o updater", async () => {
    const mem = setup({ available: { version: "0.9.1", notes: "Correções do updater" } });
    await start(mem);
    await waitFor(() => expect(text()).toContain("Flightdeck 0.9.1 disponível"));
    expect(text()).toContain("Correções do updater");
    await click("Instalar e reiniciar");
    expect(mem.calls).toEqual(["check", "install"]);
  });

  test("Depois esconde a faixa; sem versão nova não há faixa", async () => {
    const mem = setup({ available: { version: "0.9.1", notes: "" } });
    await start(mem);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Depois" })).not.toBeNull());
    await click("Depois");
    expect(text()).not.toContain("disponível");
    cleanup();
    const none = setup({ available: null });
    await start(none);
    expect(none.calls).toEqual(["check"]);
    expect(text()).not.toContain("disponível");
  });

  test("assinatura inválida ou download quebrado: mostra o erro e não instala nada", async () => {
    const mem = setup({
      available: { version: "0.9.1", notes: "" },
      installError: "signature verification failed",
    });
    await start(mem);
    await waitFor(() => expect(text()).toContain("Flightdeck 0.9.1 disponível"));
    await click("Instalar e reiniciar");
    await waitFor(() =>
      expect(text()).toContain("A atualização não foi instalada: signature verification failed"),
    );
  });

  test("Configurações: Procurar agora consulta; desligar o aviso para a verificação ao abrir", async () => {
    const mem = setup({ available: null });
    const store = await start(mem);
    await click("Configurações");
    await click("Procurar atualização agora");
    expect(mem.calls).toEqual(["check", "check"]);
    await waitFor(() => expect(text()).toContain("Você está na versão mais recente"));
    const toggle = screen.getByLabelText("Avisar sobre atualizações") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(mem.items.get(NOTIFY_UPDATES_KEY)).toBe("false");
    mem.calls.length = 0;
    await act(() => store.init());
    expect(mem.calls).toEqual([]);
  });

  test("falha ao procurar aparece na faixa, sem derrubar o app", async () => {
    const mem = setup();
    mem.platform.updater.check = async () => {
      throw new Error("sem rede");
    };
    await start(mem);
    await waitFor(() => expect(text()).toContain("não consegui procurar atualização: sem rede"));
  });

  test("procura de novo a cada intervalo enquanto o aviso estiver ligado", async () => {
    const mem = setup({ available: null });
    const store = new AppStore(mem.platform, { appUpdateIntervalMs: 20 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    await waitFor(() => expect(mem.calls.length).toBeGreaterThanOrEqual(3));
    act(() => store.setNotifyUpdates(false));
    const count = mem.calls.length;
    await Bun.sleep(80);
    expect(mem.calls).toHaveLength(count);
  });

  test("na plataforma web o updater não existe e nada é consultado", async () => {
    const mem = memoryPlatform();
    await start({ ...mem, calls: [] });
    expect(mem.platform.updater.supported).toBe(false);
    expect(await mem.platform.updater.check()).toBeNull();
    expect(text()).not.toContain("disponível");
  });
});
