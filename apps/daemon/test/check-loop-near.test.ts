import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #1361 (far-host follow-up): `host.info` says whether the app's own connection is near
 * (loopback or Tailscale), so the app shows what only a near connection may change as read-only.
 */
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("check-loop: the host says whether the app's connection is near", () => {
  test("host.info says near over loopback and not over a far address, from the socket's origin", async () => {
    const { manager, board, root } = newBoard();
    const token = "check-loop-near-token-0123456789abc";
    const base = {
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    cleanups.push(async () => {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
    });
    const nearOf = async (client: FrameClient) => {
      await client.request("hello", { token, client: "t" });
      const ack = await client.request("host.info", {});
      return (ack.data as { near?: boolean } | undefined)?.near;
    };
    expect([
      await nearOf(clients[0] as FrameClient),
      await nearOf(clients[1] as FrameClient),
    ]).toEqual([true, false]);
  });
});
