import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { BoardView } = await import("../../src/features/board/board-view.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const project = { id: "p1", name: "api", path: "/p1", projectKey: "git:acme/api" };

/** An empty board in `language`, open on its project. */
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
  await settle(
    () =>
      screen.queryByText(language === "en" ? en.states.emptyCards : ptBR.states.emptyCards) !==
      null,
    3000,
    "the empty board",
  );
}

/** The sentence that describes the open dialog (the one its aria-describedby points at). */
function described(): string {
  const dialog = screen.queryByRole("dialog");
  const id = dialog?.getAttribute("aria-describedby") ?? "";
  return (id && document.getElementById(id)?.textContent) || "";
}

describe("new-card-column: the New card dialog says which column the card goes to", () => {
  test("the + of a column opens the dialog naming that column (en)", async () => {
    await openBoard("en");
    await act(async () => {
      fireEvent.click(
        screen.queryByRole("button", { name: "New card in In progress" }) as HTMLElement,
      );
    });
    expect(screen.queryByRole("dialog", { name: "New card" }) !== null).toBe(true);
    expect(described()).toBe("It goes in the In progress column.");
  });

  test("the + of a column opens the dialog naming that column (pt-BR)", async () => {
    await openBoard("pt-BR");
    await act(async () => {
      fireEvent.click(
        screen.queryByRole("button", { name: "Novo card em Em revisão" }) as HTMLElement,
      );
    });
    expect(screen.queryByRole("dialog", { name: "Novo card" }) !== null).toBe(true);
    expect(described()).toBe("Vai para a coluna Em revisão.");
  });

  test("the empty board's first card button names Backlog", async () => {
    await openBoard("en");
    await act(async () => {
      fireEvent.click(
        screen.queryByRole("button", { name: "Create the first card" }) as HTMLElement,
      );
    });
    expect(described()).toBe("It goes in the Backlog column.");
  });
});
