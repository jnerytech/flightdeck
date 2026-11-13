import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settle, settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { BoardView } = await import("../../src/features/board/board-view.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #2596: a board whose `board.get` failed used to stay in its loading shape for good, because the
 * toast's Retry threw the answer away. The board now says the request failed and retries itself.
 */
const project = { id: "p1", name: "api", path: "/p1", projectKey: "git:acme/api" };

/** A fake host whose first `answers.length` `board.get` calls fail or answer in that order. */
async function openBoard(answers: Array<"fail" | "ok">) {
  const queue = [...answers];
  let gets = 0;
  const host = await fakeHostStore(
    {
      "board.get": () => {
        gets += 1;
        if ((queue.shift() ?? "ok") === "fail") throw new RequestError("internal", "board is down");
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
  return { ...host, gets: () => gets };
}

const retry = () => screen.queryByRole("button", { name: "Try again" });
const press = async (button: HTMLElement | null) => {
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("board-load-error", () => {
  test("a failed board request shows an error with a retry, not the loading shape", async () => {
    await openBoard(["fail"]);
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
    expect(screen.queryByText("Loading the board")).toBeNull();
    expect(screen.queryByRole("alert")?.textContent).toContain("The board did not load.");
  });

  test("the retry, once the host answers, shows the board", async () => {
    const board = await openBoard(["fail", "ok"]);
    await settleMaybe(() => retry() !== null, 3000);
    await press(retry());
    await settleMaybe(() => screen.queryByText("No cards in this project.") !== null, 3000);
    expect(screen.queryByText("No cards in this project.")).not.toBeNull();
    expect(board.gets()).toBe(2);
    expect(retry()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a retry that fails again keeps the error, with one alert and no stack of toasts", async () => {
    await openBoard(["fail", "fail"]);
    await settleMaybe(() => retry() !== null, 3000);
    await press(retry());
    await settleMaybe(() => retry() !== null, 3000);
    expect(retry()).not.toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Loading the board")).toBeNull();
  });

  test("a board that loads at first shows the loading shape, then the board", async () => {
    await openBoard(["ok"]);
    await settle(
      () => screen.queryByText("No cards in this project.") !== null,
      3000,
      "the empty board",
    );
    expect(retry()).toBeNull();
  });
});
