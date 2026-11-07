import { afterEach, describe, expect, test } from "bun:test";
import { ulid } from "../src/ulid.ts";
import { PrWatch } from "../src/watch/service.ts";
import { cleanups, fixture } from "./watch-helpers.ts";

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The service the server talks to, over the fixture's card. */
const service = (f: Fixture) =>
  new PrWatch({ board: f.board, watcher: f.watcher, fixer: f.fixer, traces: {} as never });

/** Rounds the card already had, each with what it cost. */
function spent(f: Fixture, n: number, costUsd = 0) {
  const at = new Date().toISOString();
  for (let i = 1; i <= n; i++) {
    f.store.db
      .query(
        `INSERT INTO pr_watch_rounds (id, card_id, n, status, trigger, summary, cost_usd, started_at, ended_at)
         VALUES (?, ?, ?, 'pushed', ?, NULL, ?, ?, ?)`,
      )
      .run(
        ulid(),
        f.card.id,
        i,
        JSON.stringify({ failed: [], conflicts: false, comments: [] }),
        costUsd,
        at,
        at,
      );
  }
}

/** The card ran out of rounds: the watch handed it to the person. */
async function outOfRounds(f: Fixture) {
  spent(f, 3);
  await f.fixer.onTrigger(f.trigger({ conflicts: true }));
  await f.fixer.idle();
}

/** Why a call was refused: the reason and its values, or null when it went through. */
function refusal(
  call: () => unknown,
): { reason?: string; params?: Record<string, unknown> } | null {
  try {
    call();
    return null;
  } catch (error) {
    const { reason, params } = error as { reason?: string; params?: Record<string, unknown> };
    return { reason, params };
  }
}

const snapshot = (f: Fixture) =>
  f.store.db
    .query<{ snapshot: string | null }, [string]>("SELECT snapshot FROM pr_watch WHERE card_id = ?")
    .get(f.card.id)?.snapshot ?? null;

/** Issue #77, slice D2: the person allows a card that ran out of rounds N more. */
describe("watch-extend: more fixing rounds for a card (#77)", () => {
  test("a card's watch says how many rounds count and its limit", async () => {
    const f = await fixture();
    spent(f, 2);
    expect([service(f).info(f.card.id).roundsUsed, service(f).info(f.card.id).maxRounds]).toEqual([
      2, 3,
    ]);
  });

  test("more rounds hand the card back to the watch: watched again, back in review, with the new limit", async () => {
    const f = await fixture();
    await outOfRounds(f);
    f.store.db.query("UPDATE pr_watch SET snapshot = '{}' WHERE card_id = ?").run(f.card.id);
    const info = service(f).extend(f.card.id, 2);
    expect([
      info.status,
      info.reason,
      info.roundsUsed,
      info.maxRounds,
      f.board.getCard(f.card.id).column,
      snapshot(f),
    ]).toEqual(["watching", null, 3, 5, "review", null]);
  });

  test("the next failure gets a round of the ones allowed", async () => {
    const f = await fixture();
    await outOfRounds(f);
    service(f).extend(f.card.id, 1);
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    const rounds = f.fixer.rounds(f.card.id);
    expect([
      rounds.length,
      f.promptOf(rounds[3]?.sessionId ?? null).includes("(round 4 of at most 4)"),
    ]).toEqual([4, true]);
  });

  test("a card handed over for its budget is refused more rounds, with that reason, and stays handed over", async () => {
    const f = await fixture({ settings: { budgetUsd: 2 } });
    spent(f, 3, 1);
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    const why = refusal(() => service(f).extend(f.card.id, 2));
    const info = service(f).info(f.card.id);
    expect([why, info.status, info.maxRounds, f.board.getCard(f.card.id).column]).toEqual([
      {
        reason: "watch_extend_blocked",
        params: { reason: "US$ 3.00 of US$ 2.00 spent on this PR" },
      },
      "needs_you",
      3,
      "waiting",
    ]);
  });

  test("a card whose PR is not watched is refused more rounds", async () => {
    const f = await fixture();
    f.watcher.setEnabled(f.card.id, false);
    const why = refusal(() => service(f).extend(f.card.id, 2));
    expect([why, service(f).info(f.card.id).maxRounds]).toEqual([
      { reason: "watch_off", params: undefined },
      3,
    ]);
  });

  test("rounds allowed twice add up, and watching again starts over without them", async () => {
    const f = await fixture();
    const watch = service(f);
    watch.extend(f.card.id, 1);
    const twice = watch.extend(f.card.id, 2).maxRounds;
    const again = watch.set(f.card.id, true);
    expect([twice, again.maxRounds, again.roundsUsed]).toEqual([6, 3, 0]);
  });

  test("a card that waits for you for another reason (its session asks) stays waiting, and nothing seen is news again", async () => {
    const f = await fixture();
    f.watcher.setEnabled(f.card.id, true);
    f.store.db
      .query(`UPDATE pr_watch SET snapshot = '{"seen":1}' WHERE card_id = ?`)
      .run(f.card.id);
    f.board.moveCard(f.card.id, "waiting");
    const info = service(f).extend(f.card.id, 1);
    expect([f.board.getCard(f.card.id).column, snapshot(f), info.maxRounds]).toEqual([
      "waiting",
      '{"seen":1}',
      4,
    ]);
  });

  test("a card in another column stays where it is, and nothing seen is news again", async () => {
    const f = await fixture();
    f.watcher.setEnabled(f.card.id, true);
    f.store.db
      .query(`UPDATE pr_watch SET snapshot = '{"seen":1}' WHERE card_id = ?`)
      .run(f.card.id);
    f.board.moveCard(f.card.id, "done");
    service(f).extend(f.card.id, 1);
    expect([f.board.getCard(f.card.id).column, snapshot(f)]).toEqual(["done", '{"seen":1}']);
  });
});
