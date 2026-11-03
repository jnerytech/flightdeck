/** Phase 36: a board with a project, and helpers to put usage and delivered cards into it on given days. */
import { afterEach } from "bun:test";
import { RoiSummarizer } from "../src/roi/summary.ts";
import { newBoard } from "./board-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

export const KEY = "acme/shop";

export async function roiSetup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const db = ctx.store.db;
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const summarizer = new RoiSummarizer({ db, keyOf: () => KEY });
  let seq = 0;

  /** An assistant message's usage on `day` for `key`, with `tokens` in total (split over the kinds). */
  const usage = (
    day: string,
    costUsd: number,
    tokens = 0,
    key = KEY,
    session: string | null = null,
  ) => {
    seq += 1;
    const part = Math.floor(tokens / 5);
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin, speed,
         input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, ?, ?, ?, 'claude-opus-5-5', 'app', 'standard', ?, ?, ?, ?, ?, ?)`,
    ).run(
      `m${seq}`,
      session,
      `${day}T12:00:00Z`,
      day,
      key,
      part,
      part,
      part,
      part,
      tokens - 4 * part,
      costUsd,
    );
  };

  /**
   * A card done on `doneDay`, created on `createdDay`. `over` sets the done-log's fields and the
   * card's: how it was done, the issue, the rework and the hours.
   */
  const done = (
    title: string,
    doneDay: string,
    createdDay: string,
    over: {
      via?: "merged" | "completed" | "moved";
      issueRef?: string;
      fixRounds?: number;
      fixCostUsd?: number;
      hours?: number | null;
      approx?: boolean;
    } = {},
  ) => {
    const card = ctx.board.createCard(
      project.id,
      over.issueRef
        ? { title, description: "", issueRef: over.issueRef }
        : { title, description: "" },
    );
    ctx.board.moveCard(card.id, "done");
    db.query(
      `UPDATE card_done SET done_at = ?, card_created_at = ?, via = ?, fix_rounds = ?, fix_cost_usd = ?, approx = ?
       WHERE card_id = ?`,
    ).run(
      `${doneDay}T12:00:00Z`,
      `${createdDay}T09:00:00Z`,
      over.via ?? "moved",
      over.fixRounds ?? 0,
      over.fixCostUsd ?? 0,
      over.approx ? 1 : 0,
      card.id,
    );
    if (over.hours !== undefined) {
      db.query("UPDATE cards SET estimate_hours = ? WHERE id = ?").run(over.hours, card.id);
    }
    return card;
  };

  return { ...ctx, db, project, summarizer, usage, done };
}

/** The period the tests ask about, and the one before it. */
export const PERIOD = { from: "2026-10-08", to: "2026-10-14" };
