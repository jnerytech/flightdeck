import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../../daemon/test/support/board-helpers.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { sidebarNav } from "../sidebar/helpers.ts";
import { waiter } from "../wait.ts";
import { chooseFromCardMenu } from "./card-menu.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const testingLibrary = await import("@testing-library/react");
const { cleanup } = testingLibrary;
const { act, fireEvent, render, within } = testingLibrary;

export { act, fireEvent, within };
export const screen = liveScreen(within);
export const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

const cleanups: Array<() => unknown> = [];
/** The afterEach of every board-ui file: the DOM first, then what the test started, last first. */
export async function teardown() {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const settle = waiter(4000);

/** Finalizar… and Descartar sit under the card's menu (#1197). */
export const fromMenu = (title: string, item: string) =>
  chooseFromCardMenu({ act, fireEvent, screen } as never, `Ações de ${title}`, item);
export const click = async (name: string | RegExp) => {
  // The session's views are tabs; everything else is a button.
  const button = screen.queryByRole("button", { name }) ?? screen.queryByRole("tab", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

export const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** Titles of the cards in a column, top to bottom. */
export const column = (label: string) =>
  [...(screen.queryByRole("region", { name: label })?.querySelectorAll("li[draggable]") ?? [])].map(
    (li) => (li.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );

export const cardItem = (title: string) => screen.queryByLabelText(`Card ${title}`);

/** One host with a git repository inside its allowed root, already online. */
export async function setup() {
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
    await store.roster.add({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { ...d, repo, store };
}

/** Registers the repo through the Projects screen and opens its board. */
export async function openBoard(repo: string) {
  await sidebar.hostAction("Projetos", "alfa");
  await type("Caminho do repositório", repo);
  await type("Modelo de instruções", "");
  await click("Cadastrar projeto");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByRole("heading", { name: "Board de repo" }) !== null);
}

export async function createCard(title: string, description = "faça") {
  // The form lives in a dialog the "Novo card" button opens.
  await click("Novo card");
  await type("Título do card", title);
  await type("Descrição do card", description);
  await click("Criar card");
  await settle(() => cardItem(title) !== null);
}

/** Em revisão asks for a PR before a card goes there (#78): these cards have none, so go on anyway. */
export async function moveAnyway() {
  const ask = await screen.findByRole("alertdialog");
  expect(ask.textContent).toContain("ainda precisa de um link de PR");
  await act(async () => {
    fireEvent.click(within(ask).getByRole("button", { name: "Mover mesmo assim" }));
  });
}

export async function drag(title: string, target: HTMLElement | null) {
  const item = cardItem(title);
  expect(item).not.toBeNull();
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.dragStart(item as HTMLElement);
    fireEvent.dragOver(target as HTMLElement);
    fireEvent.drop(target as HTMLElement);
  });
}

export async function openCard(title: string) {
  const open = cardItem(title)?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
}

/** A Radix menu opens on pointer down; its entries are then read or clicked. */
export async function openCardMenu(title: string) {
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

export const menuEntries = () => screen.queryAllByRole("menuitem");
export const menuEntry = (name: string) => screen.queryByRole("menuitem", { name });

export async function cardMenu(title: string, entry: string) {
  await openCardMenu(title);
  const item = menuEntry(entry);
  expect(item).not.toBeNull();
  await act(async () => {
    fireEvent.click(item as HTMLElement);
  });
}

export const dialog = () => screen.queryByRole("alertdialog");
