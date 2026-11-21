import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, uiIdle } from "../wait.ts";
import { snippetsHost } from "./ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { SnippetsPage } = await import("../../src/features/snippets/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The app over a real daemon with snippets, on the Snippets screen. */
async function open(seed?: (h: Awaited<ReturnType<typeof snippetsHost>>) => Promise<void>) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await seed?.(h);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
  const nav = screen.queryByRole("button", { name: "Snippets" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  await uiIdle();
  return { store, ...h };
}

const rows = () => {
  const list = screen.queryByRole("list", { name: "Snippets" });
  return list ? within(list).queryAllByRole("listitem") : [];
};
const rowNames = () => rows().map((r) => r.querySelector("[data-name]")?.textContent ?? "");

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await uiIdle();
};

const choose = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await uiIdle();
};

describe("snippets-ui: the screen", () => {
  test("the sidebar's Snippets item opens the screen for a host that announces snippets", async () => {
    await open();
    expect(screen.queryByRole("heading", { name: "Snippets", level: 1 })).not.toBeNull();
    expect(screen.queryByText("Nenhum snippet.")).not.toBeNull();
  });

  test("the empty list offers its own button to write the first snippet", async () => {
    await open();
    await click("Criar o primeiro snippet");
    await settle(() => screen.queryByLabelText("Nome") !== null);
    expect(screen.queryByLabelText("Nome")).not.toBeNull();
  });

  test("each snippet shows its name, type, where it lives and its tags", async () => {
    await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status", tags: ["git"] });
      await save({ name: "explicar", type: "prompt", text: "Explique {{file}}" });
    });
    expect(rowNames().sort()).toEqual(["explicar", "status"]);
    const status = within(rows().find((r) => r.textContent?.includes("status")) as HTMLElement);
    expect(status.queryByText("Comando")).not.toBeNull();
    expect(status.queryByText("Host")).not.toBeNull();
    expect(status.queryByText("git")).not.toBeNull();
    const explicar = within(rows().find((r) => r.textContent?.includes("explicar")) as HTMLElement);
    expect(explicar.queryByText("Prompt")).not.toBeNull();
  });

  test("Favoritar puts a snippet first and Desfavoritar takes it back", async () => {
    await open(async ({ save }) => {
      await save({ name: "a-primeiro", type: "command", run: "ls" });
      await save({ name: "b-segundo", type: "command", run: "pwd" });
    });
    expect(rowNames()).toEqual(["a-primeiro", "b-segundo"]);
    await click("Favoritar b-segundo");
    expect(rowNames()).toEqual(["b-segundo", "a-primeiro"]);
    await click("Desfavoritar b-segundo");
    expect(rowNames()).toEqual(["a-primeiro", "b-segundo"]);
  });

  test("the search and the type filter narrow the list", async () => {
    await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status" });
      await save({ name: "deploy", type: "command", run: "kubectl apply -f k8s" });
      await save({ name: "explicar", type: "prompt", text: "Explique o kubectl" });
    });
    await choose("Buscar snippet", "kubectl");
    expect(rowNames().sort()).toEqual(["deploy", "explicar"]);
    await choose("Tipo", "command");
    expect(rowNames()).toEqual(["deploy"]);
  });

  test("Remover asks first, then removes", async () => {
    await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status" });
    });
    await click("Remover status");
    // The confirmation is modal: the list behind it is hidden from the accessibility tree.
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    await click("Remover");
    expect(rowNames()).toEqual([]);
  });

  test("with a project chosen, its own and its versioned file's snippets show next to the host's, and an untrusted file can be trusted", async () => {
    const { repo } = await open(async ({ save, repo, writeFile }) => {
      await save({ name: "status", type: "command", run: "git status" });
      await save({
        name: "lint",
        type: "command",
        run: "bun run lint",
        scope: "project",
        projectPath: repo,
      });
      writeFile(
        '- name: testes\n  type: command\n  run: "bun test"\n- name: ruim\n  type: command\n',
      );
    });
    await choose("Projeto", repo);
    expect(rowNames().sort()).toEqual(["lint", "status", "testes"]);
    const testes = within(rows().find((r) => r.textContent?.includes("testes")) as HTMLElement);
    expect(testes.queryByText("Arquivo versionado")).not.toBeNull();
    expect(
      within(rows().find((r) => r.textContent?.includes("lint")) as HTMLElement).queryByText(
        "Projeto",
      ),
    ).not.toBeNull();
    expect(
      screen.queryByText("Não confiável: os comandos do arquivo só colam, sem rodar."),
    ).not.toBeNull();
    const ignored = screen.queryByRole("list", { name: "Entradas ignoradas" });
    expect(ignored?.textContent).toContain("ruim");
    await click("Confiar no arquivo");
    expect(screen.queryByText("Confiável: os comandos do arquivo podem rodar.")).not.toBeNull();
  });

  test("cancelling the removal keeps the snippet", async () => {
    await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status" });
    });
    await click("Remover status");
    await click("Cancelar");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rowNames()).toEqual(["status"]);
  });
});

describe("snippets-ui: the empty states say why the list is empty (#3605, #3606)", () => {
  const noHost = (lang: "en" | "pt-BR") => {
    const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(
      <TContext.Provider value={translator(lang)}>
        <SnippetsPage store={store} go={() => {}} />
      </TContext.Provider>,
    );
  };

  test("with no online host that has snippets, the screen says so, names no host and offers no dead button (pt-BR)", async () => {
    noHost("pt-BR");
    await uiIdle();
    expect(screen.queryByText("Nenhum host online guarda snippets.")).not.toBeNull();
    expect(
      screen.queryByText("Comandos e prompts salvos dos seus hosts e dos projetos deles."),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Criar o primeiro snippet" })).toBeNull();
    expect(screen.queryByText("Nenhum snippet.")).toBeNull();
  });

  test("with no online host that has snippets, the screen says so, names no host and offers no dead button (en)", async () => {
    noHost("en");
    await uiIdle();
    expect(screen.queryByText("No online host keeps snippets.")).not.toBeNull();
    expect(
      screen.queryByText("Saved commands and prompts of your hosts and their projects."),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Create the first snippet" })).toBeNull();
    expect(screen.queryByText("No snippet.")).toBeNull();
  });

  test("a search with no match says no snippet matches, offers no first-snippet button and clears the filters", async () => {
    await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status" });
    });
    await choose("Buscar snippet", "zzz-sem-resultado");
    expect(screen.queryByText("Nenhum snippet combina com a busca ou o tipo.")).not.toBeNull();
    expect(screen.queryByText("Nenhum snippet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Criar o primeiro snippet" })).toBeNull();
    await click("Limpar filtros");
    expect(rowNames()).toEqual(["status"]);
    const search = screen.queryByLabelText("Buscar snippet") as HTMLInputElement | null;
    expect(search?.value).toBe("");
    expect(document.activeElement === search).toBe(true);
  });

  test("a type filter with no match says the same, and clearing it brings the list back", async () => {
    await open(async ({ save }) => {
      await save({ name: "status", type: "command", run: "git status" });
    });
    await choose("Tipo", "prompt");
    expect(screen.queryByText("Nenhum snippet combina com a busca ou o tipo.")).not.toBeNull();
    await click("Limpar filtros");
    expect(rowNames()).toEqual(["status"]);
    expect((screen.queryByLabelText("Tipo") as HTMLSelectElement | null)?.value).toBe("");
  });

  test("with no filter and no snippet the screen keeps its own empty text and button", async () => {
    await open();
    expect(screen.queryByText("Nenhum snippet.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Criar o primeiro snippet" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
  });
});
