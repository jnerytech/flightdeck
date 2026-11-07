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
    expect(f.fixer.rounds(f.card.id).length).toBe(4);
  });

  test("more rounds do not forgive the money spent: the budget still stops the card", async () => {
    const f = await fixture({ settings: { budgetUsd: 2 } });
    spent(f, 3, 1);
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    service(f).extend(f.card.id, 2);
    await f.fixer.onTrigger(f.trigger({ conflicts: true }));
    await f.fixer.idle();
    const status = f.watcher.status(f.card.id);
    expect([f.fixer.rounds(f.card.id).length, status.status, status.reason]).toEqual([
      3,
      "needs_you",
      "US$ 3.00 of US$ 2.00 spent on this PR",
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

  test("a card that waits for you for another reason (its session asks) stays waiting", async () => {
    const f = await fixture();
    f.board.moveCard(f.card.id, "waiting");
    service(f).extend(f.card.id, 1);
    expect(f.board.getCard(f.card.id).column).toBe("waiting");
  });

  test("a card in another column stays where it is", async () => {
    const f = await fixture();
    f.board.moveCard(f.card.id, "done");
    service(f).extend(f.card.id, 1);
    expect(f.board.getCard(f.card.id).column).toBe("done");
  });
});
