import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";

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

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await h.save({ name: "do-host", type: "command", run: "uptime" });
  store.globalSnippets.save({ name: "global-um", type: "prompt", text: "Resuma {{file}}" });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
  });
  await act(() => Bun.sleep(80));
  return { store, ...h };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(80));
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await act(() => Bun.sleep(60));
};

const rows = () => {
  const list = screen.queryByRole("list", { name: "Snippets" });
  return list ? within(list).queryAllByRole("listitem") : [];
};
const rowNames = () => rows().map((r) => r.querySelector("[data-name]")?.textContent ?? "");

describe("snippets-ui: the global snippets", () => {
  test("Globais shows the app's own snippets, marked Global, apart from the host's", async () => {
    await open();
    expect(rowNames()).toEqual(["do-host"]);
    await fill("Projeto", "@global");
    expect(rowNames()).toEqual(["global-um"]);
    expect(within(rows()[0] as HTMLElement).queryByText("Global")).not.toBeNull();
  });

  test("the editor can keep a new snippet in the app, as a global one", async () => {
    const { store, hostId } = await open();
    await click("Novo snippet");
    await fill("Nome", "meu-global");
    await fill("Comando", "echo oi");
    await fill("Onde guardar", "global");
    await click("Salvar snippet");
    expect(
      store.globalSnippets
        .list()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["global-um", "meu-global"]);
    const listed = await store.hostCommand(hostId, "snippets.list", {});
    expect(listed?.snippets.map((s) => s.name)).toEqual(["do-host"]);
  });

  test("a global snippet is edited, favorited and removed in the app", async () => {
    const { store } = await open();
    await fill("Projeto", "@global");
    await click("Editar global-um");
    await fill("Texto", "Resuma {{file}} em tópicos");
    await click("Salvar snippet");
    expect(store.globalSnippets.list()[0]?.text).toBe("Resuma {{file}} em tópicos");
    await click("Favoritar global-um");
    expect(store.globalSnippets.list()[0]?.favorite).toBe(true);
    await click("Remover global-um");
    await click("Remover");
    expect(store.globalSnippets.list()).toEqual([]);
    expect(rowNames()).toEqual([]);
  });

  test("a secret in a global snippet is refused like on the host, with the offer of an action", async () => {
    await open();
    await click("Novo snippet");
    await fill("Nome", "x");
    await fill("Comando", "export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123");
    await fill("Onde guardar", "global");
    await click("Salvar snippet");
    expect(screen.queryByRole("alert")?.textContent).toContain("O snippet tem um segredo");
  });

  test("a name the app refuses for another reason shows that reason and keeps nothing", async () => {
    const { store } = await open();
    await click("Novo snippet");
    await fill("Nome", "x".repeat(65));
    await fill("Comando", "echo oi");
    await fill("Onde guardar", "global");
    await click("Salvar snippet");
    expect(screen.queryByRole("alert")?.textContent).toContain("nome de 1 a 64 caracteres");
    expect(store.globalSnippets.list().map((s) => s.name)).toEqual(["global-um"]);
  });
});
