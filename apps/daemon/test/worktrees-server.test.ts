import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { startServer } from "../src/server.ts";
import { createWorktrees } from "../src/worktrees/wiring.ts";
import { git, newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);
const TOKEN = "board-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(withPanel = true) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const path = join(ctx.repo, ".flightdeck", "worktrees", "one");
  git(ctx.repo, "worktree", "add", "-q", "-b", "fd/one", path, "main");
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    ...(withPanel
      ? {
          worktrees: createWorktrees({
            board: ctx.board,
            sessions: () => [],
            runLive: () => false,
          }),
        }
      : {}),
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
  return { client, project, path, repo: ctx.repo };
}

describe("worktrees-server: over the wire (issue #152)", () => {
  test("a host with the panel announces worktrees, and one without does not", async () => {
    const on = await serve();
    expect((await on.client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "worktrees",
    );
    const off = await serve(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features,
    ).not.toContain("worktrees");
  });

  test("worktree.list answers the worktrees and worktree.remove removes a safe one", async () => {
    const { client, project, path } = await serve();
    const list = await client.data<{ worktrees: Array<{ path: string; blockers: string[] }> }>(
      "worktree.list",
      { projectId: project.id },
    );
    expect(list?.worktrees.map((w) => w.path)).toEqual([path]);
    const done = await client.data<{ removed: Array<{ path: string }>; kept: unknown[] }>(
      "worktree.remove",
      { items: [{ projectId: project.id, path }] },
    );
    expect(done?.removed.map((r) => r.path)).toEqual([path]);
    expect(done?.kept).toEqual([]);
  });

  test("a path that is not a listed worktree is kept, and the commands need the panel", async () => {
    const { client, project, repo } = await serve();
    const done = await client.data<{ removed: unknown[]; kept: Array<{ reason: string }> }>(
      "worktree.remove",
      { items: [{ projectId: project.id, path: repo }] },
    );
    expect(done?.removed).toEqual([]);
    expect(done?.kept[0]?.reason).toBe("not_listed");
    const off = await serve(false);
    expect((await off.client.request("worktree.list", {})).ok).toBe(false);
  });
});
