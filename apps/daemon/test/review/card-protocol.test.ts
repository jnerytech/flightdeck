import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CardReviewResult, DAEMON_REASONS } from "@flightdeck/protocol";
import { Costs } from "../../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../../src/costs/pricing.ts";
import { startDaemon } from "../../src/main.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { gitRepo, newBoard } from "../board-helpers.ts";
import { FrameClient } from "../history-helpers.ts";

/** Issue #1439: card.review over the protocol, the feature that offers it, and its cost on the card. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const TOKEN = "card-review-token-0123456789abcdef";
const RESULT: CardReviewResult = {
  state: "done",
  summary: "ok",
  anchored: 1,
  loose: [],
  cached: false,
  moved: false,
};

async function server(peer?: string) {
  const asked: string[] = [];
  const { board, manager, repo } = newBoard();
  cleanups.push(() => board.stop());
  const running = startServer({
    manager,
    board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [repo],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
    cardReview: { start: async (id) => (asked.push(id), RESULT) },
    ...(peer ? { peerOf: () => peer } : {}),
  });
  cleanups.push(() => running.stop());
  const client = new FrameClient(running.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, asked };
}

describe("card-review over the protocol (#1439)", () => {
  test("a near connection asks for a card's review, and the host lists the feature", async () => {
    const { client, asked } = await server();
    expect(await client.data("card.review", { cardId: "c1" })).toEqual(RESULT);
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect([asked, info?.features?.includes("cardReview")]).toEqual([["c1"], true]);
  });

  test("a far connection is refused before anything runs", async () => {
    const { client, asked } = await server("8.8.8.8");
    const ack = await client.request("card.review", { cardId: "c1" });
    expect([ack.ok, (ack.error as { reason?: string } | undefined)?.reason, asked]).toEqual([
      false,
      "transport_refused",
      [],
    ]);
  });

  test("what a review used counts in its card's cost", () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    store.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, NULL, '2026-11-09T12:00:00Z', '2026-11-09', 'k', 'm', 'card', 'standard', 1, 1, 0, 0, 0, ?)`,
      )
      .run("card-review-c9-01J", 0.12);
    expect(new Costs({ db: store.db, pricing: DEFAULT_PRICING }).card("c9")).toBeCloseTo(0.12, 5);
    // An id with a wildcard in it names no other card's reviews.
    expect(new Costs({ db: store.db, pricing: DEFAULT_PRICING }).card("c%")).toBe(0);
  });

  test("the daemon wires the review when its runtime has the one-shot call", async () => {
    const { root } = gitRepo();
    const file = join(root, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(root, "data"),
        allowedRoots: [root],
        history: { roots: [join(root, "x")] },
      }),
    );
    const running = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => running.stop());
    const client = new FrameClient(running.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features?.includes("cardReview")).toBe(true);
  });

  test("from the review: the refusals have reasons the app words in both languages", () => {
    for (const r of [
      "card_review_running",
      "card_review_held",
      "card_review_no_diff",
      "card_review_limit",
    ]) {
      expect([r, (DAEMON_REASONS as readonly string[]).includes(r)]).toEqual([r, true]);
    }
  });
});
