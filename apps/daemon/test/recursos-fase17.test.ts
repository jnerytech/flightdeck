import { afterEach, describe, expect, test } from "bun:test";
import type { Actions } from "../src/actions/actions.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "recursos-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** What `host.info` announces for a server built with or without the actions service. */
async function features(withActions: boolean) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    ...(withActions ? { actions: {} as Actions } : {}),
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
  return (await client.data<{ features: string[] }>("host.info", {}))?.features ?? [];
}

describe("recursos-fase17: host.info announces the actions", () => {
  test("actions only when the daemon has the actions service", async () => {
    expect(await features(false)).toEqual([]);
    expect(await features(true)).toEqual(["actions"]);
  });
});
