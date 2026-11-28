import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { settle, settleMaybe } from "../wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { BoardView } = await import("../../src/features/board/board-view.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");
const { sessionKey } = await import("../../src/lib/app-store.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * A board that has not loaded knows nothing about its columns: while `board.get` is pending, or after
 * the host refused it, the five columns must not each say "Empty" beside the loading or error line.
 */
const project = { id: "p1", name: "api", path: "/p1", projectKey: "git:acme/api" };

/** A card the store already holds, as when it arrived before `board.get` answered. */
const knownCard = {
  id: "c1",
  projectId: "p1",
  title: "Cart screen",
  description: "",
  column: "in_progress",
  columnLocked: false,
  position: 1,
  slug: "cart",
  branch: "fd/cart",
  worktreePath: null,
  prUrl: null,
  prState: null,
  checksState: null,
  queued: false,
  sessionId: null,
  sessionStatus: null,
  notice: null,
  discarded: false,
  runs: [],
  waitingOn: [],
  blocking: [],
  workflowRunId: null,
  arenaOf: null,
  variant: null,
  arenaVariants: 0,
  issueRef: null,
  issueExternal: false,
  queueReason: null,
  quotaUntil: null,
  createdAt: "2026-11-08T12:00:00.000Z",
  updatedAt: "2026-11-08T12:00:00.000Z",
} as never;

type Answer = "pending" | "refused" | "empty";

/** A fake host whose `board.get` stays pending, is refused, or answers a project with no card. */
async function openBoard(answer: Answer, known = false) {
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
  if (known) {
    (host.store as unknown as { update(patch: object): void }).update({
      cards: { [sessionKey("h1", "c1")]: knownCard },
    });
  }
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

  test("a card the store already holds shows while the board is still loading", async () => {
    await openBoard("pending", true);
    await settle(
      () => screen.queryByLabelText("Card Cart screen") !== null,
      3000,
      "the known card",
    );
    expect(screen.queryByRole("button", { name: "Actions for Cart screen" }) !== null).toBe(true);
  });
});
