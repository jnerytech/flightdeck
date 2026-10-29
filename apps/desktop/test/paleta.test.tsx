import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import type { PaletteTarget } from "../src/lib/palette.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { GlobalSearch } = await import("../src/ui/GlobalSearch.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
const sections = () =>
  screen.queryAllByRole("listbox").map((list) => list.getAttribute("aria-label") ?? "");
const options = () =>
  screen.queryAllByRole("option").map((option) => option.getAttribute("aria-label") ?? "");
const selected = () =>
  screen
    .queryAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true")
    ?.getAttribute("aria-label") ?? null;
const input = () => screen.queryByLabelText("Buscar no histórico") as HTMLInputElement | null;

async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  expect(dialog()).not.toBeNull();
}

async function type(text: string) {
  expect(input()).not.toBeNull();
  await act(async () => {
    fireEvent.change(input() as HTMLInputElement, { target: { value: text } });
  });
}

async function press(key: string) {
  expect(input()).not.toBeNull();
  await act(async () => {
    const field = input() as HTMLInputElement;
    const event = fireEvent.keyDown(field, { key });
    // Enter with nothing selected submits the form (the history search), as a browser would.
    if (key === "Enter" && event) fireEvent.submit(field);
  });
}

const resultTexts = () =>
  [
    ...(screen.queryByRole("list", { name: "Resultados da busca" })?.querySelectorAll("li") ?? []),
  ].map((li) => li.textContent ?? "");

/** One host with a live session, a project ("flamingo") and a card, and one history transcript. */
async function setup() {
  const d = makeDaemon(cleanups, { terminal: { flightdeckdPath: null, wslDistro: "Ubuntu" } });
  const repo = join(d.root, "flamingo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# flamingo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const project = await d.board.addProject({ path: repo, promptTemplate: "" });
  d.board.createCard(project.id, { title: "Ajuste", description: "faça" });
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Gerenciada" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  writeTranscript(d.historyRoot, "-hist", "hist-1", [
    userLine({
      uuid: "h1",
      text: "o flamingo de setembro",
      cwd: d.project,
      ts: "2026-09-01T10:00:00.000Z",
    }),
  ]);
  d.history.scan();
  // A session opened in the terminal (hooks), live.
  const appA = join(d.root, "app-a");
  mkdirSync(appA);
  d.central.hooksInstall(true);
  await fetch(`${d.central.receptorUrl()}/hooks/SessionStart`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loadConfig(d.configFile).hooks.token}` },
    body: JSON.stringify({ session_id: "ext-1", hook_event_name: "SessionStart", cwd: appA }),
  });

  const opened: Array<[string, string[]]> = [];
  const mem = memoryPlatform();
  mem.platform.terminal = {
    supported: true,
    probe: async () => ({ windows: true, wt: true }),
    open: async (program, args) => {
      opened.push([program, args]);
    },
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000, searchTimeoutMs: 3000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(
    () =>
      store.getState().hosts[0]?.status === "online" &&
      store.getState().terminalEnv !== null &&
      (store.getState().hosts[0]?.sessions.length ?? 0) > 0 &&
      Object.keys(store.getState().externals).length > 0,
  );
  return { d, store, repo, opened };
}

describe("paleta", () => {
  test("seções na ordem; os locais aparecem e filtram na hora, sem consultar o histórico", async () => {
    const { store } = await setup();
    await openPalette();
    await settle(() => sections().length === 5);
    expect(sections()).toEqual(["Sessões ao vivo", "Cards", "Projetos", "Hosts", "Ações"]);
    expect(options()).toEqual([
      "Gerenciada",
      "app-a",
      "Ajuste",
      "flamingo",
      "alfa",
      "Nova sessão em alfa",
      "Ir para Configurações",
    ]);
    // No screen for it on this host: no "Ir para Custos".
    expect(options()).not.toContain("Ir para Custos");

    await type("ajus");
    expect(sections()).toEqual(["Cards"]);
    expect(options()).toEqual(["Ajuste"]);
    expect(store.getState().search).toBeNull();
  });

  test("setas escolhem, Enter abre; Enter sem escolha busca no histórico, que chega depois sem apagar os locais", async () => {
    const { store } = await setup();
    await openPalette();
    await settle(() => sections().length === 5);
    expect(selected()).toBeNull();
    await press("ArrowDown");
    expect(selected()).toBe("Gerenciada");
    await press("ArrowDown");
    expect(selected()).toBe("Ajuste");
    await press("ArrowUp");
    expect(selected()).toBe("Gerenciada");
    await press("Enter");
    expect(dialog()).toBeNull();
    expect(screen.queryByRole("heading", { name: "Gerenciada" })).not.toBeNull();

    await openPalette();
    await type("flamingo");
    expect(options()).toEqual(["flamingo"]);
    await press("Enter");
    await settle(() => resultTexts().length === 1);
    expect(store.getState().search?.query).toBe("flamingo");
    expect(resultTexts()[0]).toContain("o flamingo de setembro");
    expect(sections()).toEqual(["Projetos"]);
    expect(options()).toEqual(["flamingo"]);
  });

  test("Tab abre as ações do item; cada ação leva à tela certa", async () => {
    const { repo, opened } = await setup();
    const choose = async (query: string, ...keys: string[]) => {
      await openPalette();
      await settle(() => sections().length === 5);
      await type(query);
      await press("ArrowDown");
      for (const key of keys) await press(key);
    };

    await choose("flamingo", "Tab");
    expect(sections()).toEqual(["Ações de flamingo"]);
    expect(options()).toEqual(["Abrir board", "Workflows", "Abrir no terminal"]);
    expect(selected()).toBe("Abrir board");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(selected()).toBe("Abrir no terminal");
    await press("Enter");
    await settle(() => opened.length === 1);
    expect(opened[0]?.[1]).toContain(repo);
    expect(dialog()).toBeNull();

    await choose("flamingo", "Tab", "Enter");
    expect(screen.queryByRole("heading", { name: "Board de flamingo" })).not.toBeNull();

    await choose("Ajuste", "Enter");
    await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
    expect(screen.queryByRole("button", { name: "Voltar ao board" })).not.toBeNull();

    await choose("Configurações", "Enter");
    expect(screen.queryByRole("heading", { name: "Configurações" })).not.toBeNull();

    await choose("Nova sessão", "Enter");
    expect(screen.queryByRole("heading", { name: "Nova sessão em alfa" })).not.toBeNull();

    await choose("alfa", "Enter");
    expect(screen.queryByRole("region", { name: "Hooks do Claude Code" })).not.toBeNull();

    await choose("flamingo", "Tab", "ArrowDown", "Enter");
    expect(screen.queryByRole("heading", { name: "Workflows de flamingo" })).not.toBeNull();

    await choose("alfa", "Tab", "ArrowDown", "ArrowDown", "Enter");
    expect(screen.queryByRole("heading", { name: "Projetos de alfa" })).not.toBeNull();

    await choose("alfa", "Tab", "ArrowDown", "Enter");
    expect(screen.queryByRole("heading", { name: "Nova sessão em alfa" })).not.toBeNull();

    await choose("app-a", "Enter");
    expect(screen.queryByRole("heading", { name: "app-a" })).not.toBeNull();

    // Tab again (or Esc) leaves the actions for the list.
    await choose("Gerenciada", "Tab");
    expect(options()).toEqual(["Abrir", "Abrir no terminal"]);
    await press("Escape");
    expect(dialog()).not.toBeNull();
    expect(options()).toEqual(["Gerenciada"]);
  });

  test("Ir para Custos só com a tela de Custos e um host que anuncia costs", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.addHost({
      name: "alfa",
      url: d.listen(0, undefined, ["central", "workflows", "costs"]).url,
      token: TOKEN,
    });
    await poll(() => store.getState().hosts[0]?.hostInfo, 3000);
    const went: PaletteTarget[] = [];
    const palette = (costs: boolean) => (
      <GlobalSearch
        state={store.getState()}
        store={store}
        costs={costs}
        onSearch={() => {}}
        onClose={() => {}}
        onOpenHit={() => {}}
        onGo={(target) => went.push(target)}
      />
    );
    const { rerender } = render(palette(false));
    expect(options()).not.toContain("Ir para Custos");
    rerender(palette(true));
    await type("Custos");
    expect(options()).toEqual(["Ir para Custos"]);
    await press("ArrowDown");
    await press("Enter");
    expect(went).toEqual([{ kind: "costs" }]);
  });
});
