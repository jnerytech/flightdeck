import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BoardOptions } from "../src/board/board.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

const TOKEN = "roi-chave-token-0123456789abcdef";
type Keys = NonNullable<BoardOptions["projectKeys"]>;

describe("roi-chave: the board's project carries its key", () => {
  test("board.get sends the project with the key the host summarizes it under", async () => {
    const keys: Keys = { known: () => "unused", resolve: async (path) => `remote-of:${path}` };
    const ctx = newBoard({ projectKeys: keys });
    cleanups.push(() => ctx.board.stop());
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
    const added = await client.data<{ id: string; path: string }>("project.add", {
      path: ctx.repo,
    });
    const board = await client.data<{ project: { projectKey?: string } }>("board.get", {
      projectId: added?.id,
    });
    expect(board?.project.projectKey).toBe(`remote-of:${added?.path}`);
  });
});
