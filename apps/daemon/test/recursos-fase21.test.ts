import { afterEach, describe, expect, test } from "bun:test";
import type { Messaging } from "../src/messaging/messages.ts";
import type { Names } from "../src/names/names.ts";
import { startServer } from "../src/server.ts";
import type { Teams } from "../src/teams/teams.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "recursos-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** What `host.info` announces for a server built with these phase 21 services. */
async function features(parts: { messaging?: boolean; teams?: boolean; names?: boolean }) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    ...(parts.messaging ? { messaging: {} as Messaging } : {}),
    ...(parts.teams ? { teams: {} as Teams } : {}),
    ...(parts.names ? { names: {} as Names } : {}),
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

describe("recursos-fase21: host.info announces messaging, teams and names", () => {
  test("each only when the daemon has the service, so the app shows its screens only there", async () => {
    expect(await features({})).toEqual([]);
    expect(await features({ messaging: true })).toEqual(["messaging"]);
    expect(await features({ teams: true })).toEqual(["teams"]);
    expect(await features({ names: true })).toEqual(["names"]);
  });
});
