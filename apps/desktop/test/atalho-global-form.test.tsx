import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { SHORTCUT_KEY } = await import("../src/lib/shortcut.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

async function settle(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(5));
}

/** A web platform with a working fake global shortcut, Settings open. */
async function openSettings(supported = true) {
  const mem = memoryPlatform();
  const registered: string[] = [];
  mem.platform.globalShortcut = {
    supported,
    register: async (accelerator) => {
      registered.push(accelerator);
    },
    unregister: async () => {},
  };
  const store = new AppStore(mem.platform);
  render(<App store={store} />);
  await settle(() => !supported || registered.length > 0);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
  });
  return { ...mem, registered };
}

const field = () => screen.getByLabelText("Atalho global") as HTMLInputElement;
const type = (value: string) =>
  act(async () => {
    fireEvent.change(field(), { target: { value } });
  });

describe("atalho-global: the shortcut is a form", () => {
  test("Save stays off, saying why, until the text differs from the shortcut in use", async () => {
    await openSettings();
    const save = screen.getByRole("button", { name: "Salvar atalho" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.queryByText("Nada mudou")).not.toBeNull();
    await type("Ctrl+Alt+G");
    expect(
      (screen.getByRole("button", { name: "Salvar atalho" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("Nada mudou")).toBeNull();
  });

  test("submitting the form (Enter in the field) saves the shortcut", async () => {
    const { items, registered } = await openSettings();
    await type("Ctrl+Alt+G");
    const form = field().closest("form");
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    await settle(() => items.get(SHORTCUT_KEY) === "Ctrl+Alt+G");
    expect(items.get(SHORTCUT_KEY)).toBe("Ctrl+Alt+G");
    expect(registered.at(-1)).toBe("Ctrl+Alt+G");
  });

  test("a refused shortcut shows its error under the field, linked to it", async () => {
    await openSettings();
    await type("Ctrl+K");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar atalho" }));
    });
    const error = screen.getByRole("alert");
    expect(error.textContent).toBe("Ctrl+K abre a busca dentro do app; escolha outro atalho");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toContain(error.id);
  });

  test("where the shortcut is unavailable, the field and Save are off and the reason shows once", async () => {
    await openSettings(false);
    expect(field().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Salvar atalho" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryAllByText("atalho global indisponível nesta plataforma")).toHaveLength(1);
    expect(screen.queryByText("Nada mudou")).toBeNull();
  });
});
