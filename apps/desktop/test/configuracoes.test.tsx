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
const { AppStore, CLOSE_TO_TRAY_KEY } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

/** Web platform with recorded close-to-tray calls and an optional fake auto-start. */
function setup(autostart: "unsupported" | "supported" = "unsupported", stored?: string) {
  const mem = memoryPlatform();
  const closeToTray: boolean[] = [];
  const autostartCalls: boolean[] = [];
  let enabled = false;
  mem.platform.setCloseToTray = async (value) => {
    closeToTray.push(value);
  };
  if (autostart === "supported") {
    mem.platform.autostart = {
      supported: true,
      isEnabled: async () => enabled,
      setEnabled: async (value) => {
        autostartCalls.push(value);
        enabled = value;
      },
    };
  }
  if (stored !== undefined) mem.platform.storage.setItem(CLOSE_TO_TRAY_KEY, stored);
  const store = new AppStore(mem.platform);
  render(<App store={store} />);
  return { ...mem, store, closeToTray, autostartCalls };
}

async function openSettings() {
  const button = screen.queryByRole("button", { name: "Configurações" });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  // The Settings screen loads on demand: wait for it (its "Tema" control) before the test reads it.
  for (let waited = 0; screen.queryByLabelText("Tema") === null && waited < 5000; waited += 20) {
    await act(() => Bun.sleep(20));
  }
}

const checkbox = (label: string) => {
  const element = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(element).not.toBeNull();
  return element as HTMLInputElement;
};

describe("configuracoes", () => {
  test("cada controle de Aparência tem um rótulo visível que o foca", async () => {
    setup();
    await openSettings();
    for (const label of ["Tema", "Densidade da lista", "Tamanho da fonte do terminal", "Idioma"]) {
      const control = screen.getByLabelText(label) as HTMLInputElement;
      expect(control.labels?.length).toBe(1);
    }
  });

  test("padrões: fechar manda para a bandeja; iniciar com o Windows desligado", async () => {
    const { closeToTray } = setup("supported");
    await openSettings();
    await waitFor(() => expect(closeToTray).toEqual([true]));
    expect(checkbox("Fechar a janela manda para a bandeja").checked).toBe(true);
    expect(checkbox("Iniciar com o Windows").checked).toBe(false);
  });

  test("desligar a bandeja aplica na plataforma e persiste; o valor salvo vale no próximo início", async () => {
    const { closeToTray, items } = setup();
    await openSettings();
    await act(async () => {
      fireEvent.click(checkbox("Fechar a janela manda para a bandeja"));
    });
    expect(closeToTray.at(-1)).toBe(false);
    expect(items.get(CLOSE_TO_TRAY_KEY)).toBe("false");
    cleanup();

    const next = setup("unsupported", "false");
    await waitFor(() => expect(next.closeToTray).toEqual([false]));
  });

  test("iniciar com o Windows liga e desliga pelo plugin", async () => {
    const { autostartCalls } = setup("supported");
    await openSettings();
    await act(async () => {
      fireEvent.click(checkbox("Iniciar com o Windows"));
    });
    await waitFor(() => expect(checkbox("Iniciar com o Windows").checked).toBe(true));
    await act(async () => {
      fireEvent.click(checkbox("Iniciar com o Windows"));
    });
    expect(autostartCalls).toEqual([true, false]);
  });

  test("sem suporte a auto-start a opção fica desabilitada e explica o motivo", async () => {
    setup("unsupported");
    await openSettings();
    expect(checkbox("Iniciar com o Windows").disabled).toBe(true);
    expect(screen.queryByText("indisponível nesta plataforma")).not.toBeNull();
  });
});
