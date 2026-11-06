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
  // The first screen of a run is loaded on demand.
  await settle(() => screen.queryByLabelText(label) !== null);
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

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

/** A Radix menu opens on pointer down; its entries are then read or clicked. */
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

const menuEntry = (name: string) => screen.queryByRole("menuitem", { name });

async function cardMenu(title: string, entry: string) {
  await openCardMenu(title);
  const item = menuEntry(entry);
  expect(item).not.toBeNull();
  await act(async () => {
    fireEvent.click(item as HTMLElement);
  });
}

const optionValue = (select: HTMLElement, text: string) => {
  const option = [...select.querySelectorAll("option")].find((o) => o.textContent === text);
  expect(option).toBeDefined();
  return (option as HTMLOptionElement).value;
};

/** Adds `blocker` to the open card's blockers, from its detail. */
async function addBlocker(blocker: string) {
  // The section is there once the host has announced deps.
  await settle(() => screen.queryByLabelText("Adicionar bloqueio") !== null);
  const select = screen.queryByLabelText("Adicionar bloqueio");
  expect(select).not.toBeNull();
  await act(async () => {
    fireEvent.change(select as HTMLElement, {
      target: { value: optionValue(select as HTMLElement, blocker) },
    });
  });
  await click("Adicionar");
  await settle(
    () => screen.queryByRole("button", { name: `Remover bloqueio ${blocker}` }) !== null,
  );
}

const back = () => click("Voltar ao board");

/** Cards A and B on the board of one project, B blocked by A. */
async function blocked() {
  const ctx = await setup();
  await openBoard(ctx.repo);
  await createCard("A");
  await createCard("B");
  await openCard("B");
  await addBlocker("A");
  await back();
  await settle(() => cardItem("B")?.textContent?.includes("Bloqueado · 1") === true);
  return ctx;
}

describe("deps-ui: the board", () => {
  test("a blocked card wears a badge, and the card that holds it up says how many it holds", async () => {
    await blocked();
    expect(cardItem("B")?.textContent).toContain("Bloqueado · 1");
    expect(cardItem("A")?.textContent).toContain("Bloqueando 1");
    expect(cardItem("A")?.textContent).not.toContain("Bloqueado ·");
  });

  test("starting a blocked card says why, in a sentence with the blockers' titles", async () => {
    await blocked();
    await cardMenu("B", "Iniciar card");
    // The menu's Start asks for the workflow and persona first (issue #188).
    await settle(() => screen.queryByRole("dialog", { name: "Iniciar card" }) !== null);
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog", { name: "Iniciar card" })).getByRole("button", {
          name: "Iniciar",
        }),
      );
    });
    await settle(() => screen.queryByText(/Este card está bloqueado por: A\./) !== null);
    expect(screen.queryByText(/Este card está bloqueado por: A\./)).not.toBeNull();
  });

  test("when the blocker is done the badge goes and the card is marked unblocked, until dismissed", async () => {
    await blocked();
    await cardMenu("A", "Mover para Concluído");
    await settle(() => cardItem("B")?.textContent?.includes("Desbloqueado") === true);
    expect(cardItem("B")?.textContent).not.toContain("Bloqueado ·");
    await openCard("B");
    await click("Dispensar aviso");
    await settle(() => screen.queryByRole("button", { name: "Dispensar aviso" }) === null);
    await back();
    expect(cardItem("B")?.textContent).not.toContain("Desbloqueado");
  });

  test("the Blocked filter keeps only the cards that wait", async () => {
    await blocked();
    await click("Bloqueados");
    expect(cardItem("A")).toBeNull();
    expect(cardItem("B")).not.toBeNull();
    await click("Bloqueados");
    expect(cardItem("A")).not.toBeNull();
  });
});

describe("deps-ui: the card's detail", () => {
  test("lists the blockers with their column, and removing one frees the card", async () => {
    await blocked();
    await openCard("B");
    const section = screen.queryByRole("region", { name: "Bloqueado por" });
    expect(section?.textContent).toContain("A");
    expect(section?.textContent).toContain("Backlog");
    await click("Remover bloqueio A");
    await settle(() => screen.queryByRole("button", { name: "Remover bloqueio A" }) === null);
    await back();
    expect(cardItem("B")?.textContent).not.toContain("Bloqueado ·");
  });

  test("a host that does not announce deps shows no section and no filter", async () => {
    const { store } = await blocked();
    const hosts = store.getState().hosts;
    const bare = hosts.map((h) =>
      h.hostInfo
        ? {
            ...h,
            hostInfo: { ...h.hostInfo, features: h.hostInfo.features?.filter((f) => f !== "deps") },
          }
        : h,
    );
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({ hosts: bare });
    });
    expect(screen.queryByRole("button", { name: "Bloqueados" })).toBeNull();
    await openCard("B");
    expect(screen.queryByRole("region", { name: "Bloqueado por" })).toBeNull();
  });

  test("the card shows what it holds up", async () => {
    await blocked();
    await openCard("A");
    const section = screen.queryByRole("region", { name: "Bloqueando" });
    expect(section?.textContent).toContain("B");
  });

  test("the condition and the auto-start are chosen here and kept with the card", async () => {
    const { store } = await blocked();
    await openCard("B");
    const when = screen.queryByLabelText("Libera quando o bloqueio está");
    expect(when).not.toBeNull();
    await act(async () => {
      fireEvent.change(when as HTMLElement, { target: { value: "merged" } });
    });
    const auto = screen.queryByLabelText("Iniciar sozinho quando liberar");
    expect(auto).not.toBeNull();
    await act(async () => {
      fireEvent.click(auto as HTMLElement);
    });
    const kept = () => Object.values(store.getState().cards).find((card) => card.title === "B");
    await settle(() => kept()?.unblockWhen === "merged" && kept()?.autoStart !== null);
    expect(kept()?.unblockWhen).toBe("merged");
    expect(kept()?.autoStart).toEqual({ workflow: null });
  });

  test("a card is not offered as a blocker when it would close a cycle", async () => {
    await blocked();
    await openCard("A");
    const select = screen.queryByLabelText("Adicionar bloqueio");
    expect(select?.textContent).not.toContain("B");
  });

  test("the chain shows the blockers of the blockers, and says how many lie deeper", async () => {
    await blocked();
    await createCard("C");
    await createCard("D");
    await createCard("E");
    await openCard("C");
    await addBlocker("B");
    await back();
    await openCard("D");
    await addBlocker("C");
    await back();
    await openCard("E");
    await addBlocker("D");
    const chain = screen.queryByRole("region", { name: "Bloqueado por" })?.textContent ?? "";
    for (const title of ["D", "C", "B"]) expect(chain).toContain(title);
    expect(chain).toContain("e mais 1");
  });
});
