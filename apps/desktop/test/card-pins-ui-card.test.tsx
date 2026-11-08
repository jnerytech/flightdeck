import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

/** Issue #76: the card's detail pins a document of the project's library, against a real daemon. */
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
  await settle(() => screen.queryByLabelText(label) !== null);
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** One host with a repository whose library holds an ADR, already online. */
async function setup() {
  const d = makeDaemon(cleanups, { knowledge: true });
  const repo = join(d.root, "repo");
  mkdirSync(join(repo, "docs/adr"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  writeFileSync(join(repo, "docs/adr/0001-sqlite.md"), "---\nstatus: valid\n---\n# Usar SQLite\n");
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

async function openNewCard(repo: string) {
  await sidebar.hostAction("Projetos", "alfa");
  await type("Caminho do repositório", repo);
  await type("Modelo de instruções", "");
  await click("Cadastrar projeto");
  await settle(() => screen.queryByRole("button", { name: "Abrir board de repo" }) !== null);
  await click("Abrir board de repo");
  await settle(() => screen.queryByRole("heading", { name: "Board de repo" }) !== null);
  await click("Novo card");
  await type("Título do card", "Fixar");
  await type("Descrição do card", "faça");
  await click("Criar card");
  await settle(() => screen.queryByLabelText("Card Fixar") !== null);
  const open = screen.queryByLabelText("Card Fixar")?.querySelector("button") ?? null;
  expect(open).not.toBeNull();
  await act(async () => {
    fireEvent.click(open as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
}

const panel = () => screen.queryByRole("region", { name: "Documentos fixados" });

describe("card-pins-ui-card: pinning from the card's detail", () => {
  test("the library's document is chosen in the card and the card then lists it, kept by the host", async () => {
    const { repo, store } = await setup();
    await openNewCard(repo);
    await settle(() => panel() !== null);
    expect(panel()).not.toBeNull();
    const pick = () => panel()?.querySelector<HTMLSelectElement>("select") ?? null;
    await settle(() => (pick()?.options.length ?? 0) > 1);
    expect(pick()?.options.length).toBeGreaterThan(1);
    await act(async () => {
      fireEvent.change(pick() as HTMLElement, { target: { value: "docs/adr/0001-sqlite.md" } });
    });
    // Choosing only picks (#1088): Fixar pins it.
    const pin = panel()?.querySelector<HTMLButtonElement>("button:not([aria-label])") ?? null;
    expect(pin?.textContent).toBe("Fixar");
    await act(async () => {
      fireEvent.click(pin as HTMLElement);
    });
    await settle(() => panel()?.querySelector("li")?.textContent?.includes("Usar SQLite") === true);
    const kept = Object.values(store.getState().cards).find((card) => card.title === "Fixar");
    expect(kept?.pinnedDocs).toEqual(["docs/adr/0001-sqlite.md"]);
  });

  test("a host that does not announce cardPins shows no such panel", async () => {
    const { repo, store } = await setup();
    await openNewCard(repo);
    await settle(() => panel() !== null);
    expect(panel()).not.toBeNull();
    const bare = store.getState().hosts.map((h) =>
      h.hostInfo
        ? {
            ...h,
            hostInfo: {
              ...h.hostInfo,
              features: h.hostInfo.features?.filter((f) => f !== "cardPins"),
            },
          }
        : h,
    );
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({ hosts: bare });
    });
    await settle(() => panel() === null);
    expect(panel()).toBeNull();
  });
});
