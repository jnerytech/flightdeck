import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { BoardView } = await import("../../src/features/board/board-view.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const project = { id: "p1", name: "api", path: "/p1", projectKey: "git:acme/api" };
const SAID = {
  en: "alfa is offline. The board shows its last state; moves and new cards need it back.",
  "pt-BR":
    "alfa está offline. O board mostra o último estado; mover e criar cards precisam dele de volta.",
};

/** A loaded, empty board of the host "alfa" in `language`. */
async function openBoard(language: "en" | "pt-BR") {
  const host = await fakeHostStore(
    { "board.get": () => ({ project, cards: [] }) },
    { hostId: "h1", language, fallback: {} },
  );
  host.store.i18n.start();
  render(
    <BoardView
      store={host.store}
      hostId="h1"
      projectId="p1"
      onOpenCard={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  const empty = (language === "en" ? en : ptBR).states.emptyCards;
  await settle(() => screen.queryByText(empty) !== null, 3000, "the loaded board");
  return host.store;
}

/** The host drops or comes back: the store says so to every screen, as its link does. */
async function hostIs(store: Awaited<ReturnType<typeof openBoard>>, online: boolean) {
  await act(async () => {
    seedHosts(store, [{ id: "h1", name: "alfa", online }]);
    (store as unknown as { update(patch: object): void }).update({ hosts: store.getState().hosts });
  });
}

describe("board-offline: a board whose host is offline says it shows the last state", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`the line appears when the host drops and goes when it is back, in ${language}`, async () => {
      const store = await openBoard(language);
      expect(screen.queryByText(SAID[language]) === null).toBe(true);
      await hostIs(store, false);
      expect(screen.queryByText(SAID[language]) !== null).toBe(true);
      await hostIs(store, true);
      expect(screen.queryByText(SAID[language]) === null).toBe(true);
    });
  }
});
