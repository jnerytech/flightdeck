import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BoardResult } from "@flightdeck/protocol";
import { useSyncExternalStore } from "react";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import type { Route } from "../src/lib/router.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/features/projects/project.tsx");
const { BoardView } = await import("../src/ui/BoardView.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { Router } = await import("../src/lib/router.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const HOST = {
  id: "h1",
  name: "alfa",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: ["projectTrust"] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};
const PROJECT = { id: "p1", name: "api", path: "/work/api", baseBranch: "main" };

function board(cards: number): BoardResult {
  const one = {
    id: "c1",
    projectId: "p1",
    title: "A card",
    description: "",
    column: "backlog",
    position: 0,
  };
  return {
    project: PROJECT,
    columns: [{ column: "backlog", cards: cards > 0 ? [one] : [] }],
  } as never;
}

function setup(options: { language?: "en" | "pt-BR"; cards?: number; refused?: boolean } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const asked = { board: false };
  store.hostCommand = (async (_host: string, type: string) => {
    if (type === "project.trust.state") {
      return { items: [{ path: "/work/api", trusted: false, via: null }] };
    }
    if (type !== "board.get") return null;
    asked.board = true;
    return options.refused ? null : board(options.cards ?? 0);
  }) as never;
  const appState = {
    ...store.getState(),
    hosts: [HOST],
    projects: { h1: [PROJECT] },
  } as never as ReturnType<typeof store.getState>;
  const went: Route[] = [];
  const view = (
    <ProjectPage
      store={store}
      state={appState}
      hostId="h1"
      projectId="p1"
      go={(route) => went.push(route)}
    />
  );
  return { view, went, asked };
}

/** The page has asked for the board and drawn what it answered. */
async function answered(asked: { board: boolean }) {
  await settleMaybe(() => asked.board);
  expect(asked.board).toBe(true);
  await act(async () => {});
}

const LANGUAGES = [
  ["en", en],
  ["pt-BR", ptBR],
] as const;

for (const [language, words] of LANGUAGES) {
  describe(`project-next-step (${language}): a project with no cards points at the first card (#1547)`, () => {
    test("one line and one button open the page, and the button opens the Board's New card", async () => {
      const { view, went } = setup({ language });
      render(view);
      await settleMaybe(() => screen.queryByText(words.projectPage.nextCard) !== null);
      expect(screen.queryByText(words.projectPage.nextCard)).not.toBeNull();
      const button = screen.queryByRole("button", { name: words.kanban.newCard });
      expect(button).not.toBeNull();
      fireEvent.click(button as HTMLElement);
      expect(went).toEqual([{ name: "board", host: "h1", projectId: "p1", newCard: true }]);
    });

    test("the line comes before the tiles", async () => {
      render(setup({ language }).view);
      await settleMaybe(() => screen.queryByText(words.projectPage.nextCard) !== null);
      const line = screen.queryByText(words.projectPage.nextCard);
      expect(line).not.toBeNull();
      const tiles = document.querySelector("[data-slot='project-destinations']") as HTMLElement;
      const where = (line as HTMLElement).compareDocumentPosition(tiles);
      expect(Boolean(where & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });

    test("a project that has a card shows no next step", async () => {
      const { view, asked } = setup({ language, cards: 1 });
      render(view);
      await answered(asked);
      expect(screen.queryByText(words.projectPage.nextCard)).toBeNull();
    });

    test("a board that could not be read says nothing about cards", async () => {
      const { view, asked } = setup({ language, refused: true });
      render(view);
      await answered(asked);
      expect(screen.queryByText(words.projectPage.nextCard)).toBeNull();
    });

    test("the trust panel says in one sentence that cards run either way and what trusting adds", async () => {
      render(setup({ language }).view);
      await settle(
        () => screen.queryByRole("region", { name: words.projectPage.trust.title }) !== null,
      );
      const panel = screen.queryByRole("region", { name: words.projectPage.trust.title });
      expect(within(panel as HTMLElement).queryByText(words.projectPage.trust.hint)).not.toBeNull();
      expect(words.projectPage.trust.hint).toMatch(
        language === "en" ? /^Cards run either way/ : /^Os cards rodam com ou sem/,
      );
    });
  });
}

describe("project-next-step: the Board opens New card when the route asks for it (#1547)", () => {
  function boardView(newCard: boolean) {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    (store as unknown as { update(p: object): void }).update({
      hosts: [HOST],
      projects: { h1: [PROJECT] },
      cards: {},
    });
    store.hostCommand = (async (_hostId: string, type: string) =>
      type === "board.get" ? board(0) : {}) as never;
    render(
      <TContext.Provider value={store.i18n.t}>
        <BoardView
          store={store}
          hostId="h1"
          projectId="p1"
          {...(newCard ? { newCard: true } : {})}
          onOpenCard={() => {}}
          onOpenSettings={() => {}}
        />
      </TContext.Provider>,
    );
  }

  test("with newCard the dialog is open as the board shows", async () => {
    boardView(true);
    await settleMaybe(() => screen.queryByRole("dialog", { name: "New card" }) !== null);
    expect(screen.queryByRole("dialog", { name: "New card" })).not.toBeNull();
  });

  test("without it the board opens with no dialog", async () => {
    boardView(false);
    await settle(() => screen.queryByRole("button", { name: "New card" }) !== null);
    expect(screen.queryByRole("dialog", { name: "New card" })).toBeNull();
  });
});

function Frame(props: {
  store: InstanceType<typeof AppStore>;
  router: InstanceType<typeof Router>;
}) {
  const { store, router } = props;
  const route = useSyncExternalStore(router.subscribe, () => router.current);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return (
    <TContext.Provider value={store.i18n.t}>
      {route.name === "project" && (
        <ProjectPage
          store={store}
          state={state}
          hostId="h1"
          projectId="p1"
          go={(next) => router.push(next)}
        />
      )}
      {route.name === "board" && (
        <BoardView
          key="h1/p1"
          store={store}
          hostId="h1"
          projectId="p1"
          newCard={route.newCard === true}
          onOpenCard={() =>
            router.push({ name: "card", host: "h1", projectId: "p1", cardId: "c1" })
          }
          onOpenSettings={() => {}}
        />
      )}
      {route.name === "card" && <p>The card page</p>}
    </TContext.Provider>
  );
}

describe("project-next-step: going back to the Board entry opens no dialog (#1582)", () => {
  /** The app's wiring of a route: a Router that draws the project page, the Board or a card. */
  function app() {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const router = new Router({ name: "project", host: "h1", projectId: "p1" });
    (store as unknown as { router: unknown }).router = router;
    (store as unknown as { update(p: object): void }).update({
      hosts: [HOST],
      hostsLoaded: true,
      projects: { h1: [PROJECT] },
      cards: {},
    });
    store.loadProjects = (async () => []) as never;
    store.refreshHub = (async () => {}) as never;
    store.hostCommand = (async (_hostId: string, type: string) => {
      if (type === "project.trust.state") {
        return { items: [{ path: "/work/api", trusted: false, via: null }] };
      }
      return type === "board.get" ? board(0) : null;
    }) as never;
    render(<Frame store={store} router={router} />);
    return router;
  }
  const dialog = () => screen.queryByRole("dialog", { name: "New card" });
  const boardRoute = { name: "board", host: "h1", projectId: "p1" } as const;

  /** The next-step link of the project page, which opens the Board with the dialog. */
  async function followLink() {
    await settleMaybe(() => screen.queryByText(en.projectPage.nextCard) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New card" }));
    });
    await settleMaybe(() => dialog() !== null);
  }

  test("the link opens the dialog, and once it has opened the entry no longer asks for it", async () => {
    const router = app();
    await followLink();
    expect(dialog()).not.toBeNull();
    expect(router.current).toEqual(boardRoute);
  });

  test("close the dialog, open a card, go back: the board shows no dialog", async () => {
    const router = app();
    await followLink();
    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: "Cancel" }));
    await settle(() => dialog() === null);
    await act(async () => {
      router.push({ name: "card", host: "h1", projectId: "p1", cardId: "c1" });
    });
    await settle(() => screen.queryByText("The card page") !== null);
    await act(async () => {
      router.back();
    });
    expect(router.current).toEqual(boardRoute);
    await settle(() => screen.queryByText("The card page") === null);
    await settle(() => screen.queryByRole("button", { name: "New card" }) !== null);
    await act(async () => {});
    expect(dialog()).toBeNull();
  });

  test("with the dialog still open, leaving and coming back shows no dialog either", async () => {
    const router = app();
    await followLink();
    await act(async () => {
      router.push({ name: "card", host: "h1", projectId: "p1", cardId: "c1" });
    });
    await settle(() => screen.queryByText("The card page") !== null);
    await act(async () => {
      router.back();
    });
    await settle(() => screen.queryByText("The card page") === null);
    await settle(() => screen.queryByRole("button", { name: "New card" }) !== null);
    await act(async () => {});
    expect(dialog()).toBeNull();
  });
});
