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

const YAML = [
  "- name: testes",
  "  type: command",
  "  run: bun test",
  "- name: revisar",
  "  type: prompt",
  "  text: Revise isto.",
  "- name: com-segredo",
  "  type: command",
  "  run: export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
].join("\n");

async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
  });
  await act(() => Bun.sleep(100));
  const button = screen.queryByRole("button", { name: "Importar de arquivo" });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  const input = screen.queryByLabelText(
    "Arquivo de snippets (YAML ou JSON)",
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    fireEvent.change(input as HTMLElement, {
      target: { files: [new File([YAML], "snippets.yaml", { type: "text/yaml" })] },
    });
  });
  await settle(() => screen.queryByRole("list", { name: "Snippets do arquivo" }) !== null);
  return { store, ...h };
}

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

describe("snippets-ui: import from a file", () => {
  test("the file's snippets are listed, with the reason for each one left out and no secret shown", async () => {
    await open();
    const list = screen.queryByRole("list", { name: "Snippets do arquivo" }) as HTMLElement;
    expect(
      within(list)
        .queryAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["testes", "revisar"]);
    const left = screen.queryByRole("list", { name: "Entradas ignoradas" });
    expect(left?.textContent).toContain("com-segredo");
    expect(document.body.innerHTML).not.toContain("ghp_");
  });

  test("they go to the host's snippets", async () => {
    const { store, hostId } = await open();
    await click("Importar do arquivo");
    expect(screen.queryByText("Importados: 2")).not.toBeNull();
    const listed = await store.hostCommand(hostId, "snippets.list", {});
    expect(listed?.snippets.map((s) => s.name).sort()).toEqual(["revisar", "testes"]);
  });

  test("or to the app's global snippets", async () => {
    const { store, hostId } = await open();
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Importar o arquivo para") as HTMLElement, {
        target: { value: "global" },
      });
    });
    await click("Importar do arquivo");
    expect(
      store.globalSnippets
        .list()
        .map((s) => s.name)
        .sort(),
    ).toEqual(["revisar", "testes"]);
    expect((await store.hostCommand(hostId, "snippets.list", {}))?.snippets).toEqual([]);
  });
});
