import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { FakeCli } from "../../../scripts/test/fake-cli.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { pluginsHost } from "./plugins-ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
const fakes: FakeCli[] = [];
afterEach(async () => {
  cleanup();
  // The daemon stops first: a request still in flight must not meet the sentinel `claude`.
  for (const fn of cleanups.splice(0).reverse()) await fn();
  for (const fake of fakes.splice(0)) fake.restore();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

/** The Plugins screen of a host that keeps them. */
async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await pluginsHost(cleanups, store, fakes);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("plugins") === true);
  await settle(() => screen.queryByRole("button", { name: "Plugins" }) !== null);
  const nav = screen.queryByRole("button", { name: "Plugins" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  await settle(() => screen.queryByRole("heading", { name: "Plugins", level: 1 }) !== null);
  return { store, ...h };
}

const dialog = () => screen.queryByRole("dialog", { name: "Escolher pasta" });
const inDialog = (name: string | RegExp) =>
  within(dialog() as HTMLElement).queryByRole("button", { name });
async function pressInDialog(name: string | RegExp) {
  await settle(() => inDialog(name) !== null);
  expect(inDialog(name)).not.toBeNull();
  await act(async () => {
    fireEvent.click(inDialog(name) as HTMLElement);
  });
}

describe("plugins-ui: a pasta de um plugin local", () => {
  test("Procurar… abre o seletor e a pasta escolhida preenche o campo, que continua digitável", async () => {
    const { d } = await open();
    mkdirSync(join(d.root, "meu-plugin", "hooks"), { recursive: true });
    await settle(() => screen.queryByRole("button", { name: "Procurar…" }) !== null);
    expect(screen.queryByRole("button", { name: "Procurar…" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
    });
    await settle(() => dialog() !== null);
    await pressInDialog(new RegExp(`^${basename(d.root)}`));
    await pressInDialog("meu-plugin");
    // Its own subfolder shows once the listing of meu-plugin has arrived.
    await settle(() => inDialog("hooks") !== null);
    await pressInDialog("Escolher esta pasta");
    const field = screen.getByLabelText("Pasta de um plugin local") as HTMLInputElement;
    await settle(() => field.value !== "");
    expect(field.value).toBe(join(d.root, "meu-plugin"));
    await act(async () => {
      fireEvent.change(field, { target: { value: "/fora/das/pastas" } });
    });
    expect(field.value).toBe("/fora/das/pastas");
  });

  test("Cancelar fecha o seletor e o campo fica como estava", async () => {
    await open();
    await settle(() => screen.queryByRole("button", { name: "Procurar…" }) !== null);
    const field = screen.getByLabelText("Pasta de um plugin local") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "/digitada" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
    });
    await settle(() => dialog() !== null);
    await pressInDialog("Cancelar");
    await settle(() => dialog() === null);
    expect(dialog()).toBeNull();
    expect(field.value).toBe("/digitada");
  });

  test("diz que Procurar mostra só as pastas do host e que outra se digita", async () => {
    await open();
    await settle(() => screen.queryByLabelText("Pasta de um plugin local") !== null);
    expect(
      screen.queryByText(
        "Procurar mostra as pastas que este host permite. Digite o caminho para usar outra pasta.",
      ),
    ).not.toBeNull();
  });
});
