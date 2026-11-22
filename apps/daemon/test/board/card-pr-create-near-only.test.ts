import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { newBoard } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "card-pr-near-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3815: opening a pull request pushes the card's branch, which runs the repository's pre-push hook,
 * so it needs a near connection (this computer or Tailscale), as merging one does.
 */
describe("card.pr.create needs a near connection (#3815)", () => {
  test("a far connection is refused before the card is looked at; a near one reaches the card", async () => {
    const { board, manager, root } = newBoard();
    const base = {
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    cleanups.push(async () => {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
      await board.stop();
    });
    for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
    const [near, far] = clients as [FrameClient, FrameClient];
    const reasonOf = async (call: Promise<{ error?: unknown }>) =>
      ((await call).error as { reason?: string } | undefined)?.reason ?? null;
    const farReason = await reasonOf(far.request("card.pr.create", { cardId: "no-such-card" }));
    const nearReason = await reasonOf(near.request("card.pr.create", { cardId: "no-such-card" }));
    expect([farReason, nearReason === "transport_refused"]).toEqual(["transport_refused", false]);
  });
});
