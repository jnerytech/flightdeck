import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { DEFAULT_SHORTCUT, SHORTCUT_KEY, validateShortcut } = await import("../src/lib/shortcut.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

const settle = waiter(3000);

/**
 * Web platform with a fake global shortcut: records calls, keeps the handlers and refuses the
 * accelerators in `taken` (another program already uses them).
 */
function setup(opts: { taken?: string[]; stored?: string } = {}) {
  const mem = memoryPlatform();
  const calls: string[] = [];
  const handlers = new Map<string, () => void>();
  let shown = 0;
  mem.platform.globalShortcut = {
    supported: true,
    register: async (accelerator, onPress) => {
      calls.push(`register ${accelerator}`);
      if (opts.taken?.includes(accelerator)) throw new Error("HotKey already registered");
      handlers.set(accelerator, onPress);
    },
    unregister: async (accelerator) => {
      calls.push(`unregister ${accelerator}`);
      handlers.delete(accelerator);
    },
  };
  mem.platform.showMainWindow = async () => {
    shown++;
  };
  if (opts.stored) mem.platform.storage.setItem(SHORTCUT_KEY, opts.stored);
  const store = new AppStore(mem.platform);
  render(<App store={store} />);
  return { ...mem, store, calls, handlers, shown: () => shown };
}

async function openSettings() {
  const button = screen.queryByRole("button", { name: "Configurações" });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
}

async function saveShortcut(value: string) {
  const input = screen.queryByLabelText("Atalho global") as HTMLInputElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    fireEvent.change(input as HTMLInputElement, { target: { value } });
  });
  const save = screen.queryByRole("button", { name: "Salvar atalho" });
  expect(save).not.toBeNull();
  await act(async () => {
    fireEvent.click(save as HTMLElement);
  });
}

describe("atalho-global", () => {
  test("validação: formato, modificador obrigatório e Ctrl+K recusado", () => {
    expect(DEFAULT_SHORTCUT).toBe("Ctrl+Alt+F");
    const value = (text: string) => {
      const check = validateShortcut(text);
      return check.ok ? check.value : `erro: ${check.error}`;
    };
    expect(value("Ctrl+Alt+F")).toBe("Ctrl+Alt+F");
    // Normalized: spacing, case, aliases and modifier order.
    expect(value(" alt + control + f ")).toBe("Ctrl+Alt+F");
    expect(value("Super+Shift+9")).toBe("Shift+Super+9");
    expect(value("Cmd+F12")).toBe("Super+F12");
    expect(value("Ctrl+K")).toBe("erro: Ctrl+K abre a busca dentro do app; escolha outro atalho");
    expect(value("control+k")).toBe(
      "erro: Ctrl+K abre a busca dentro do app; escolha outro atalho",
    );
    const noModifier = "erro: use ao menos Ctrl, Alt ou Super";
    expect(value("K")).toBe(noModifier);
    expect(value("Shift+F")).toBe(noModifier);
    const format = "erro: formato esperado: Modificadores+Tecla, por exemplo Ctrl+Alt+F";
    for (const bad of ["", "Ctrl+", "Ctrl+Alt", "Ctrl+Ctrl+F", "Hyper+F", "Ctrl+FF", "Ctrl+F25"]) {
      expect(value(bad)).toBe(format);
    }
  });

  test("o atalho padrão é registrado e, apertado, traz o app para frente com a busca aberta", async () => {
    const { calls, handlers, shown } = setup();
    await settle(() => calls.length > 0);
    expect(calls).toEqual(["register Ctrl+Alt+F"]);
    expect(screen.queryByRole("dialog", { name: "Busca global" })).toBeNull();
    await act(async () => {
      handlers.get("Ctrl+Alt+F")?.();
    });
    expect(shown()).toBe(1);
    expect(screen.queryByRole("dialog", { name: "Busca global" })).not.toBeNull();
  });

  test("trocar o atalho valida, re-registra e persiste; o salvo vale no próximo início", async () => {
    const { calls, items } = setup();
    await settle(() => calls.length > 0);
    await openSettings();
    expect((screen.queryByLabelText("Atalho global") as HTMLInputElement | null)?.value).toBe(
      "Ctrl+Alt+F",
    );
    await saveShortcut("Ctrl+K");
    expect(
      screen.queryByText("Ctrl+K abre a busca dentro do app; escolha outro atalho"),
    ).not.toBeNull();
    expect(calls).toEqual(["register Ctrl+Alt+F"]);

    await saveShortcut("shift+ctrl+y");
    await settle(() => calls.length === 3);
    expect(calls).toEqual([
      "register Ctrl+Alt+F",
      "unregister Ctrl+Alt+F",
      "register Ctrl+Shift+Y",
    ]);
    expect(items.get(SHORTCUT_KEY)).toBe("Ctrl+Shift+Y");
    expect(screen.queryByText(/escolha outro atalho/)).toBeNull();
    cleanup();

    const next = setup({ stored: "Ctrl+Shift+Y" });
    await settle(() => next.calls.length > 0);
    expect(next.calls).toEqual(["register Ctrl+Shift+Y"]);
  });

  test("falha de registro avisa e abre a configuração para escolher outro", async () => {
    const { calls, items } = setup({ taken: ["Ctrl+Alt+F", "Ctrl+Alt+G"] });
    await settle(() => screen.queryByLabelText("Atalho global") !== null);
    // Settings opened by itself, with the warning.
    expect(screen.queryByLabelText("Atalho global")).not.toBeNull();
    const warning =
      "O atalho Ctrl+Alt+F não pôde ser registrado: outro programa já deve usá-lo. Escolha outro.";
    expect(screen.queryByText(warning)).not.toBeNull();

    // Another taken one keeps the warning and is not saved.
    await saveShortcut("Ctrl+Alt+G");
    // Nothing was registered before (F was taken), so there is nothing to unregister: two calls.
    await settle(() => calls.length === 2);
    expect(calls).toEqual(["register Ctrl+Alt+F", "register Ctrl+Alt+G"]);
    expect(screen.queryByText(warning.replace("Ctrl+Alt+F", "Ctrl+Alt+G"))).not.toBeNull();
    expect(items.get(SHORTCUT_KEY)).toBeUndefined();

    await saveShortcut("Ctrl+Alt+H");
    await settle(() => items.get(SHORTCUT_KEY) === "Ctrl+Alt+H");
    expect(items.get(SHORTCUT_KEY)).toBe("Ctrl+Alt+H");
    expect(screen.queryByText(/não pôde ser registrado/)).toBeNull();
    expect(calls.at(-1)).toBe("register Ctrl+Alt+H");
  });

  test("na plataforma web o atalho global fica indisponível e explica o motivo", async () => {
    const mem = memoryPlatform();
    const store = new AppStore(mem.platform);
    render(<App store={store} />);
    await openSettings();
    expect((screen.queryByLabelText("Atalho global") as HTMLInputElement | null)?.disabled).toBe(
      true,
    );
    expect(screen.queryByText("atalho global indisponível nesta plataforma")).not.toBeNull();
  });
});
