import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cardWhen, newBoard } from "../support/board-helpers.ts";

// Real git and a setup script that runs in a shell: more than the default 5 s on a loaded machine.
setDefaultTimeout(20_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

describe("a card run that fails to launch (#3404)", () => {
  test("with a workflow watcher attached, the failure is recorded and nothing is thrown", async () => {
    const ctx = newBoard();
    boards.push(ctx.board);
    const { board } = ctx;
    const project = await board.addProject({ path: ctx.repo, setupScript: "exit 3" });
    const card = board.createCard(project.id, { title: "Falha", description: "d" });
    board.workflows.watch(() => {});
    // What the pump's `.catch` would leave unhandled: a throw from the engine's `fail`.
    const thrown: unknown[] = [];
    const fail = board.workflows.fail.bind(board.workflows);
    board.workflows.fail = (...args) => {
      try {
        fail(...args);
      } catch (error) {
        thrown.push(error);
      }
    };
    await board.startCard(card.id);
    const failed = await cardWhen(board, card.id, (c) => c.notice !== null);
    expect(thrown).toEqual([]);
    expect(failed?.notice ?? "").toContain("setup script failed (exit 3)");
    expect(failed?.column).toBe("waiting");
    expect(failed?.runs[0]?.endedAt).not.toBeNull();
  });
});
