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

async function open(seed?: (h: Awaited<ReturnType<typeof snippetsHost>>) => Promise<void>) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await seed?.(h);
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
  await act(() => Bun.sleep(100));
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await act(() => Bun.sleep(30));
};

const rowNames = () => {
  const list = screen.queryByRole("list", { name: "Snippets" });
  return list
    ? within(list)
        .queryAllByRole("listitem")
        .map((r) => r.querySelector("[data-name]")?.textContent ?? "")
    : [];
};
const fieldsPreview = () => {
  const list = screen.queryByRole("list", { name: "Campos" });
  return list
    ? within(list)
        .queryAllByRole("listitem")
        .map((li) => li.textContent ?? "")
    : [];
};

describe("snippets-ui: the editor", () => {
  test("a command's variables become fields in the preview, and their default and options are saved", async () => {
    const { store, hostId } = await open();
    await click("Novo snippet");
    await fill("Nome", "testes");
    await fill("Tipo do snippet", "command");
    await fill("Comando", "cd {{cwd}} && bun test {{arquivo}}");
    expect(fieldsPreview()).toEqual(["cwd (do contexto)", "arquivo"]);
    await fill("Padrão de arquivo", "a.test.ts");
    await fill("Opções de arquivo (separadas por vírgula)", "a.test.ts, b.test.ts");
    await fill("Etiquetas (separadas por vírgula)", "bun");
    await click("Salvar snippet");
    expect(rowNames()).toEqual(["testes"]);
    const saved = await store.hostCommand(hostId, "snippets.get", { name: "testes" });
    expect(saved).toMatchObject({
      type: "command",
      run: "cd {{cwd}} && bun test {{arquivo}}",
      vars: { arquivo: { default: "a.test.ts", options: ["a.test.ts", "b.test.ts"] } },
      tags: ["bun"],
    });
  });

  test("a prompt has a text instead of a command", async () => {
    const { store, hostId } = await open();
    await click("Novo snippet");
    await fill("Nome", "revisar");
    await fill("Tipo do snippet", "prompt");
    expect(screen.queryByLabelText("Comando")).toBeNull();
    await fill("Texto", "Revise {{file}} procurando injeção.");
    expect(fieldsPreview()).toEqual(["file (do contexto)"]);
    await click("Salvar snippet");
    expect(await store.hostCommand(hostId, "snippets.get", { name: "revisar" })).toMatchObject({
      type: "prompt",
      text: "Revise {{file}} procurando injeção.",
    });
  });

  test("Salvar snippet stays closed until there is a name and a command or text", async () => {
    await open();
    await click("Novo snippet");
    const save = () =>
      screen.queryByRole("button", { name: "Salvar snippet" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await fill("Nome", "x");
    expect(save().disabled).toBe(true);
    await fill("Comando", "ls");
    expect(save().disabled).toBe(false);
  });

  test("a snippet with a secret is refused with the reason and the offer to make it an action", async () => {
    await open();
    await click("Novo snippet");
    await fill("Nome", "deploy");
    await fill(
      "Comando",
      "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789' https://x",
    );
    await click("Salvar snippet");
    expect(screen.queryByRole("alert")?.textContent).toContain(
      "O snippet tem um segredo e não pode ser salvo.",
    );
    expect(screen.queryByRole("button", { name: "Transformar em ação" })).not.toBeNull();
    expect(rowNames()).toEqual([]);
  });

  test("Editar opens a snippet filled in and saves the change in place", async () => {
    const { store, hostId } = await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status" });
    });
    await click("Editar status");
    expect((screen.queryByLabelText("Comando") as HTMLInputElement).value).toBe("git status");
    await fill("Comando", "git status -sb");
    await click("Salvar snippet");
    const listed = await store.hostCommand(hostId, "snippets.list", {});
    expect(listed?.snippets.map((s) => [s.name, s.run])).toEqual([["status", "git status -sb"]]);
  });

  test("with a project chosen, a snippet can go to the project's versioned file", async () => {
    const { repo } = await open();
    await fill("Projeto", repo);
    await click("Novo snippet");
    await fill("Nome", "lint");
    await fill("Comando", "bun run lint");
    await fill("Onde guardar", "file");
    await click("Salvar snippet");
    const list = screen.queryByRole("list", { name: "Snippets" }) as HTMLElement;
    expect(within(list).queryByText("Arquivo versionado")).not.toBeNull();
    expect(await Bun.file(`${repo}/.flightdeck/snippets.yaml`).text()).toContain("bun run lint");
  });
});
