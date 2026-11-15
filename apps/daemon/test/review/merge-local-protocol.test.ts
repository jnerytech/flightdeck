import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { git } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { cleanups, commit, ready, runCleanups } from "../support/review-merge-local.ts";

// Real git in temp repositories, with a worktree: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "merge-token-0123456789abcdef";
afterEach(runCleanups);

describe("merge-local pelo protocolo", () => {
  test("card.updateFromBase e card.mergeLocal pelo protocolo", async () => {
    const ctx = await ready();
    commit(ctx.worktree, "feito.txt", "feito\n");
    commit(ctx.repo, "c.txt", "c\n");
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data("card.updateFromBase", { cardId: ctx.cardId })).toMatchObject({
      id: ctx.cardId,
    });
    expect(git(ctx.worktree, "rev-list", "--left-right", "--count", "main...HEAD")).toBe("0\t1");
    expect(
      await client.data("card.mergeLocal", { cardId: ctx.cardId, mode: "squash", confirm: true }),
    ).toMatchObject({ column: "done" });
  });
});
