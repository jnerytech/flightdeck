import { afterEach, describe, expect, test } from "bun:test";
import { Automations } from "../src/automations/automations.ts";
import { cleanups, fixture } from "./watch-helpers.ts";

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #77, slice D1: every automatic fix of a card counts against one budget, the watch's
 * `maxRounds`: the watch's own rounds and an automation that sends a failure or a review comment to
 * the card. Past it nothing more is sent, and the card goes to "Needs you" with the reason.
 */
describe("fix-round-cap: one budget of automatic fixes per card (#77)", () => {
  test("an automation's send counts as a round of the card; past the cap it is refused and the card needs you", async () => {
    const f = await fixture();
    const spent = [1, 2, 3, 4].map(() => f.fixer.spend(f.card.id, "checks failed: CI"));
    expect([
      spent.map((refusal) => refusal === null),
      f.fixer.rounds(f.card.id).map((r) => r.status),
      f.board.getCard(f.card.id).column,
      f.watcher.status(f.card.id).status,
      (spent[3] ?? "").startsWith("limit of 3 rounds reached"),
    ]).toEqual([[true, true, true, false], ["sent", "sent", "sent"], "waiting", "needs_you", true]);
  });

  test("the watch's own round past the cap also takes the card to Needs you", async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) f.fixer.spend(f.card.id, "a review comment");
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    expect([
      f.fixer.rounds(f.card.id).length,
      f.board.getCard(f.card.id).column,
      f.watcher.status(f.card.id).status,
    ]).toEqual([3, "waiting", "needs_you"]);
  });

  test("an automation sends to a card only while it has rounds left, and says why it did not", async () => {
    const f = await fixture();
    const asked: string[] = [];
    let left = 1;
    const automations = new Automations({
      db: f.store.db,
      board: f.board,
      issues: { list: async () => [], createCard: async () => f.card } as never,
      fixRounds: {
        spend: (cardId, cause) => {
          asked.push(`${cardId}: ${cause}`);
          return left-- > 0 ? null : "limit of 3 rounds reached";
        },
      },
    });
    cleanups.push(() => automations.stop());
    const saved = automations.save({
      projectId: f.project.id,
      name: "CI",
      trigger: { type: "ci_failed" },
      action: { type: "send_to_card" },
    });
    automations.toggle(saved.id, true, true);
    await automations.fire({ type: "ci_failed", cardId: f.card.id, key: "k1", summary: "CI" });
    await automations.fire({ type: "ci_failed", cardId: f.card.id, key: "k2", summary: "CI" });
    expect([
      asked.length,
      asked[0]?.startsWith(f.card.id) ?? false,
      automations
        .runs(saved.id)
        .map((r) => [r.status, r.detail])
        .reverse(),
    ]).toEqual([
      2,
      true,
      [
        ["ok", `enviado ao card ${f.card.id}`],
        ["skipped", "limit of 3 rounds reached"],
      ],
    ]);
  });
});
