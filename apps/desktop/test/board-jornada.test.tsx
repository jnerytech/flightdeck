import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** Titles of the cards in a column, top to bottom. */
const _column = (label: string) =>
  [...(screen.queryByRole("region", { name: label })?.querySelectorAll("li[draggable]") ?? [])].map(
    (li) => (li.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );

const cardItem = (title: string) => screen.queryByLabelText(`Card ${title}`);

/** One host with a git repository inside its allowed root, already online. */
async function setup() {
  const d = makeDaemon(cleanups);
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { ...d, repo, store };
}

/** Registers the repo through the Projects screen and opens its board. */
async function openBoard(repo: string) {
  await sidebar.hostAction("Projetos", "alfa");
  await type("Caminho do repositório", repo);
  await type("Modelo de instruções", "");
  await click("Cadastrar projeto");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByRole("heading", { name: "Board de repo" }) !== null);
}

async function createCard(title: string, description = "faça") {
  // The form lives in a dialog the "Novo card" button opens.
  await click("Novo card");
  await type("Título do card", title);
  await type("Descrição do card", description);
  await click("Criar card");
  await settle(() => cardItem(title) !== null);
}

async function openCard(title: string) {
  const open = cardItem(title)?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
}

async function openCardMenu(title: string) {
  const trigger = screen.queryByRole("button", { name: `Ações de ${title}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(trigger as HTMLElement);
  });
}

const toastText = () => document.body.textContent ?? "";
const toastButtons = (name: string) => screen.queryAllByRole("button", { name });

describe("board-jornada: the board says what happened to a card (issue #188, J5)", () => {
  test("creating a card shows a toast with Abrir, and Abrir opens the new card", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Login");
    await settle(() => toastText().includes("Card criado: Login"));
    await act(async () => {
      fireEvent.click(toastButtons("Abrir")[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
    expect(screen.queryByRole("button", { name: "Voltar ao board" })).not.toBeNull();
  });

  test("Iniciar card from the card menu says it started, with Abrir to the card", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Login");
    await openCardMenu("Login");
    const entry = screen.queryByRole("menuitem", { name: "Iniciar card" });
    expect(entry).not.toBeNull();
    await act(async () => {
      fireEvent.click(entry as HTMLElement);
    });
    await settle(() => toastText().includes("Card iniciado: Login"));
    // The created toast is still up, so there are two.
    expect(toastButtons("Abrir")).toHaveLength(2);
  });

  test("Parar is off, and says the card is not running, until the card has been started", async () => {
    const { repo } = await setup();
    await openBoard(repo);
    await createCard("Login");
    await openCard("Login");
    const stop = () => screen.queryByRole("button", { name: "Parar" }) as HTMLButtonElement | null;
    expect(stop()?.disabled).toBe(true);
    expect(screen.queryByText("O card não está rodando")).not.toBeNull();
  });
});
