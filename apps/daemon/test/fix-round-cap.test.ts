import { afterEach, describe, expect, test } from "bun:test";
import { Automations } from "../src/automations/automations.ts";
import { ulid } from "../src/ulid.ts";
import { cleanups, fixture } from "./watch-helpers.ts";

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** An automation that sends each failed CI of the project to its card, over the real fixer. */
function sendToCard(f: Fixture) {
  const sent: string[] = [];
  const message = f.board.message.bind(f.board);
  f.board.message = (cardId, text) => {
    sent.push(cardId);
    return message(cardId, text);
  };
  const automations = new Automations({
    db: f.store.db,
    board: f.board,
    issues: { list: async () => [], createCard: async () => f.card } as never,
    prWatch: { claims: (cardId) => f.fixer.claims(cardId) },
  });
  cleanups.push(() => automations.stop());
  const saved = automations.save({
    projectId: f.project.id,
    name: "CI",
    trigger: { type: "ci_failed" },
    action: { type: "send_to_card" },
  });
  automations.toggle(saved.id, true, true);
  let key = 0;
  return {
    sent,
    fire: () =>
      automations.fire({ type: "ci_failed", cardId: f.card.id, key: `k${++key}`, summary: "CI" }),
    runs: () =>
      automations
        .runs(saved.id)
        .map((r) => [r.status, r.detail])
        .reverse(),
  };
}

/** Rounds the card already had: the watch's budget used up. */
function spent(f: Fixture, n: number) {
  const at = new Date().toISOString();
  for (let i = 1; i <= n; i++) {
    f.store.db
      .query(
        `INSERT INTO pr_watch_rounds (id, card_id, n, status, trigger, summary, started_at, ended_at)
         VALUES (?, ?, ?, 'pushed', ?, NULL, ?, ?)`,
      )
      .run(
        ulid(),
        f.card.id,
        i,
        JSON.stringify({ failed: [], conflicts: false, comments: [] }),
        at,
        at,
      );
  }
}

/**
 * Issue #77, slice D1: while a card's PR is watched, the watch alone fixes it, within its rounds;
 * an automation sends it no failure or comment of its own. Out of rounds, the card goes to Needs you.
 */
describe("fix-round-cap: the watch alone fixes a watched PR, and hands it over (#77)", () => {
  test("a card whose PR is not watched gets the automation's send, as before, and no round", async () => {
    const f = await fixture();
    f.watcher.setEnabled(f.card.id, false);
    const auto = sendToCard(f);
    await auto.fire();
    expect([
      auto.runs(),
      auto.sent,
      f.fixer.rounds(f.card.id).length,
      f.watcher.status(f.card.id).status,
    ]).toEqual([[["ok", `enviado ao card ${f.card.id}`]], [f.card.id], 0, "watching"]);
  });

  test("a watched card gets nothing from the automation: the watch fixes it", async () => {
    const f = await fixture();
    const auto = sendToCard(f);
    await auto.fire();
    expect([auto.runs(), auto.sent, f.fixer.rounds(f.card.id).length]).toEqual([
      [["skipped", "the PR watch fixes this card"]],
      [],
      0,
    ]);
  });

  test("a card that needs you gets nothing either, with the watch's reason, and stays where it is", async () => {
    const f = await fixture();
    f.watcher.markNeedsYou(f.card.id, "2 rounds in a row failed: CI");
    const auto = sendToCard(f);
    await auto.fire();
    await auto.fire();
    expect([auto.runs(), auto.sent, f.board.getCard(f.card.id).column]).toEqual([
      [
        ["skipped", "2 rounds in a row failed: CI"],
        ["skipped", "2 rounds in a row failed: CI"],
      ],
      [],
      "review",
    ]);
  });

  test("a card in review out of rounds goes to Needs you with each round in the reason", async () => {
    const f = await fixture();
    spent(f, 3);
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    const status = f.watcher.status(f.card.id);
    expect([
      f.fixer.rounds(f.card.id).length,
      f.board.getCard(f.card.id).column,
      status.status,
      status.reason,
    ]).toEqual([
      3,
      "waiting",
      "needs_you",
      "limit of 3 rounds reached — round 1: pushed; round 2: pushed; round 3: pushed",
    ]);
  });

  test("a card already done stays done when the watch hands it over", async () => {
    const f = await fixture();
    spent(f, 3);
    f.board.moveCard(f.card.id, "done");
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    expect([f.board.getCard(f.card.id).column, f.watcher.status(f.card.id).status]).toEqual([
      "done",
      "needs_you",
    ]);
  });
});
