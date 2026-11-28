import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settle, settleMaybe } from "../wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { BoardView } = await import("../../src/features/board/board-view.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * A board that has not loaded knows nothing about its columns: while `board.get` is pending, or after
 * the host refused it, the five columns must not each say "Empty" beside the loading or error line.
 */
const project = { id: "p1", name: "api", path: "/p1", projectKey: "git:acme/api" };

type Answer = "pending" | "refused" | "empty";

/** A fake host whose `board.get` stays pending, is refused, or answers a project with no card. */
async function openBoard(answer: Answer) {
  const host = await fakeHostStore(
    {
      "board.get": () => {
        if (answer === "pending") return new Promise(() => {});
        if (answer === "refused") throw new RequestError("internal", "board is down");
        return { project, cards: [] };
      },
    },
    { hostId: "h1", language: "en", fallback: {} },
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
  return host;
}

/** The dashed "Empty, New card" box each column shows when it has no card. */
const emptyBoxes = () => screen.queryAllByRole("button", { name: /^Empty, / });

describe("board-columns-loading", () => {
  test("while the board loads, no column says it is empty", async () => {
    await openBoard("pending");
    await settle(
      () => screen.queryByRole("status", { name: "Loading the board" }) !== null,
      3000,
      "the loading line",
    );
    expect(emptyBoxes()).toHaveLength(0);
  });

  test("after a refused read, no column says it is empty beside the error", async () => {
    await openBoard("refused");
    await settleMaybe(() => screen.queryByRole("button", { name: "Try again" }) !== null, 3000);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeNull();
    expect(emptyBoxes()).toHaveLength(0);
  });

  test("a loaded project with no card shows every column empty", async () => {
    await openBoard("empty");
    await settle(
      () => screen.queryByText("No cards in this project.") !== null,
      3000,
      "the empty board",
    );
    expect(emptyBoxes()).toHaveLength(5);
  });
});
