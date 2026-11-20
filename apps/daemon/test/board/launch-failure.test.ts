import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cardWhen, git, newBoard } from "../support/board-helpers.ts";
import { poll } from "../support/helpers.ts";

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

  test("when recording the failure throws too, the daemon logs it and goes on", async () => {
    const logs: string[] = [];
    const ctx = newBoard({ log: (line) => logs.push(line) });
    boards.push(ctx.board);
    const { board } = ctx;
    const project = await board.addProject({ path: ctx.repo, setupScript: "exit 3" });
    const card = board.createCard(project.id, { title: "Falha dupla", description: "d" });
    board.workflows.fail = () => {
      throw new Error("recording went wrong");
    };
    await board.startCard(card.id);
    await poll(() => logs.length > 0 || null, 3000);
    expect(logs).toEqual([expect.stringContaining("recording went wrong")]);
  });

  test("a repository with no commit says so on the card, not git's own error", async () => {
    const ctx = newBoard();
    boards.push(ctx.board);
    const { board } = ctx;
    const empty = join(ctx.root, "empty");
    mkdirSync(empty);
    git(empty, "init", "-q", "-b", "main");
    const project = await board.addProject({ path: empty, baseBranch: "main" });
    const card = board.createCard(project.id, { title: "Sem commit", description: "d" });
    await board.startCard(card.id);
    const failed = await cardWhen(board, card.id, (c) => c.notice !== null);
    expect(failed?.noticeReason).toBe("repo_has_no_commit");
    expect(failed?.notice ?? "").toContain("no commit");
    expect(failed?.column).toBe("waiting");
    expect(failed?.worktreePath).toBeNull();
  });
});
