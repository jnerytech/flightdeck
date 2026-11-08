import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import type { PrProvider, PrStatus } from "../src/board/pr.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

// Real git (a worktree and a bare origin): more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("board-idle: stop() lets a PR poll round that is in flight finish", () => {
  test("idle() resolves only after the round that was asking the provider when stop() came", async () => {
    const answer = Promise.withResolvers<PrStatus>();
    let asked = 0;
    const provider: PrProvider = {
      create: async () => "https://github.com/acme/app/pull/3",
      status: () => {
        asked++;
        return answer.promise;
      },
      url: async () => null,
      comments: async () => [],
      health: async () => ({ checks: [], conflicts: false }),
      buildLog: async () => "",
    };
    // The default interval is long: the only round is the one this test starts.
    const { board, repo, root } = newBoard({ prProvider: () => provider });
    cleanups.push(() => board.stop());
    const project = await board.addProject({
      path: repo,
      prProvider: "github",
      promptTemplate: "",
    });
    const card = board.createCard(project.id, { title: "PR", description: "faça" });
    await board.startCard(card.id);
    expect(await cardWhen(board, card.id, (c) => c.column === "review")).not.toBeNull();
    git(root, "init", "-q", "--bare", "remote.git");
    git(repo, "remote", "add", "origin", join(root, "remote.git"));
    await board.createPr(card.id);

    const round = board.pollPrs();
    expect(await cardWhen(board, card.id, () => asked === 1)).not.toBeNull();
    board.stop();
    let idle = false;
    const idled = board.idle().then(() => {
      idle = true;
    });
    // Only microtasks can run here: if idle() did not wait for the provider it would be done.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const whileAsking = idle;
    answer.resolve({ state: "open", checks: null });
    await round;
    await idled;
    expect({ whileAsking, afterAnswer: idle }).toEqual({ whileAsking: false, afterAnswer: true });
  });

  test("idle() with no round in flight resolves at once", async () => {
    const { board } = newBoard();
    cleanups.push(() => board.stop());
    await board.idle();
    expect(true).toBe(true);
  });
});
