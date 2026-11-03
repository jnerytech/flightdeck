import { Database } from "bun:sqlite";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Board } from "../src/board/board.ts";
import type { PrProvider } from "../src/board/pr.ts";
import { readDone } from "../src/roi/done-log.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "A card", description: "" });
  return { ...ctx, db: ctx.store.db, project, card };
}

const mergedProvider = (): PrProvider => ({
  create: async () => "",
  status: async () => ({ state: "merged", checks: null }),
  url: async () => null,
  comments: async () => [],
  health: async () => ({ builds: [], conflicts: false }) as never,
  buildLog: async () => "",
});

describe("roi-registro: the done-log", () => {
  test("a manual move to Concluído writes one row with when, how, the project and the card's creation", async () => {
    const s = await setup();
    s.board.moveCard(s.card.id, "done");
    const row = readDone(s.db, s.card.id);
    expect(row).toMatchObject({
      cardId: s.card.id,
      projectId: s.project.id,
      via: "moved",
      prUrl: null,
      cardCreatedAt: s.card.createdAt,
      fixRounds: 0,
      fixCostUsd: 0,
      approx: false,
    });
    expect(Number.isNaN(Date.parse(row?.doneAt ?? ""))).toBe(false);
  });

  test("completing a card is how completed", async () => {
    const s = await setup();
    await s.board.completeCard(s.card.id, true);
    expect(readDone(s.db, s.card.id)?.via).toBe("completed");
  });

  test("a merged PR is how merged, with the PR and the fix rounds and what they cost", async () => {
    const s = await setup();
    s.db
      .query("UPDATE cards SET pr_url = ?, pr_state = 'open', board_column = 'review' WHERE id = ?")
      .run("https://github.com/acme/app/pull/9", s.card.id);
    for (const [n, cost] of [
      [1, 0.5],
      [2, 1.0],
    ] as const) {
      s.db
        .query(
          `INSERT INTO pr_watch_rounds (id, card_id, n, status, trigger, cost_usd, started_at)
           VALUES (?, ?, ?, 'done', 'ci', ?, ?)`,
        )
        .run(`r${n}`, s.card.id, n, cost, "2026-10-02T10:00:00Z");
    }
    // A board that starts with an open PR polls it: the provider says it was merged.
    const polling = new Board({
      db: s.db,
      manager: s.manager,
      allowedRoots: [s.root],
      prProvider: () => mergedProvider(),
      prPollIntervalMs: 30,
    });
    cleanups.push(() => polling.stop());
    await cardWhen(polling, s.card.id, (c) => c.column === "done");
    expect(readDone(s.db, s.card.id)).toMatchObject({
      via: "merged",
      prUrl: "https://github.com/acme/app/pull/9",
      fixRounds: 2,
      fixCostUsd: 1.5,
    });
  });

  test("leaving Concluído and coming back keeps the first row", async () => {
    const s = await setup();
    s.board.moveCard(s.card.id, "done");
    const first = readDone(s.db, s.card.id);
    s.board.moveCard(s.card.id, "review");
    await Bun.sleep(5);
    s.board.moveCard(s.card.id, "done");
    expect(readDone(s.db, s.card.id)).toEqual(first);
    expect(s.db.query("SELECT COUNT(*) AS n FROM card_done").get()).toEqual({ n: 1 });
  });

  test("a card that is not done has no row, and a discarded one loses it", async () => {
    const s = await setup();
    expect(readDone(s.db, s.card.id)).toBeNull();
    s.board.moveCard(s.card.id, "done");
    expect(readDone(s.db, s.card.id)).not.toBeNull();
    await s.board.discardCard(s.card.id, true);
    expect(s.db.query("SELECT COUNT(*) AS n FROM card_done").get()).toEqual({ n: 0 });
  });

  test("the migration gives the cards already in Concluído an approximate row from their last update", () => {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS.slice(0, -2)) db.exec(sql);
    db.exec(
      `INSERT INTO projects (id, path, name, base_branch, pr_provider, prompt_template, auto_approve)
       VALUES ('p1', '/x', 'x', 'main', 'none', '', '{}')`,
    );
    db.exec(
      `INSERT INTO cards (id, project_id, title, description, board_column, position, created_at, updated_at)
       VALUES ('c1', 'p1', 'old', '', 'done', 1, '2026-09-01T10:00:00Z', '2026-09-20T10:00:00Z'),
              ('c2', 'p1', 'open', '', 'review', 2, '2026-09-02T10:00:00Z', '2026-09-21T10:00:00Z')`,
    );
    db.exec(MIGRATIONS.at(-2) as string);
    expect(readDone(db, "c1")).toEqual({
      cardId: "c1",
      projectId: "p1",
      doneAt: "2026-09-20T10:00:00Z",
      via: "moved",
      prUrl: null,
      cardCreatedAt: "2026-09-01T10:00:00Z",
      fixRounds: 0,
      fixCostUsd: 0,
      approx: true,
    });
    expect(readDone(db, "c2")).toBeNull();
  });
});
