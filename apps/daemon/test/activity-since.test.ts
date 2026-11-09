import { describe, expect, test } from "bun:test";
import type { QuotaWindow } from "@flightdeck/protocol";
import { activitySince } from "../src/activity/since.ts";
import { EventStore } from "../src/store/event-store.ts";

/**
 * Issue #1344: "While you were away". What ended, reached review, merged or failed on this host
 * since a time, read from what is already stored; each list is capped and the query writes nothing.
 */
const SINCE = "2026-11-08T22:00:00.000Z";
const IN = "2026-11-08T23:00:00.000Z";
const OUT = "2026-11-08T21:00:00.000Z";

function seeded() {
  const store = new EventStore(":memory:");
  const db = store.db;
  db.query(
    "INSERT INTO projects (id, path, name, base_branch, pr_provider, prompt_template) VALUES ('p1', '/r', 'shop', 'main', 'github', '')",
  ).run();
  const session = (id: string, status: string, at: string, name: string | null = null) =>
    db
      .query(
        "INSERT INTO sessions (id, name, cwd, status, permission_mode, created_at, updated_at) VALUES (?, ?, '/r', ?, 'default', ?, ?)",
      )
      .run(id, name, status, OUT, at);
  const card = (
    id: string,
    column: string,
    at: string,
    pr: { url?: string; state?: string; checks?: string; doneAt?: string } = {},
  ) => {
    if (pr.doneAt) {
      db.query(
        "INSERT INTO card_done (card_id, project_id, done_at, via, pr_url, card_created_at) VALUES (?, 'p1', ?, 'merged', ?, ?)",
      ).run(id, pr.doneAt, pr.url ?? null, OUT);
    }
    return db
      .query(
        `INSERT INTO cards (id, project_id, title, description, board_column, position, pr_url, pr_state, checks_state, created_at, updated_at)
         VALUES (?, 'p1', ?, '', ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(id, `title ${id}`, column, pr.url ?? null, pr.state ?? null, pr.checks ?? null, OUT, at);
  };
  const run = (
    id: string,
    cardId: string,
    status: string,
    endedAt: string | null,
    why?: { text: string; key: string; params: object },
  ) =>
    db
      .query(
        `INSERT INTO workflow_runs (id, card_id, workflow_name, workflow_hash, definition, status, status_reason, status_reason_key, status_reason_params, budget, usage, inputs, started_at, ended_at)
         VALUES (?, ?, 'ship', 'h', '', ?, ?, ?, ?, '{}', '{}', '{}', ?, ?)`,
      )
      .run(
        id,
        cardId,
        status,
        why?.text ?? null,
        why?.key ?? null,
        why ? JSON.stringify(why.params) : null,
        OUT,
        endedAt,
      );
  return { store, db, session, card, run };
}

describe("activity-since (#1344)", () => {
  test("only the sessions that ended since the time are listed, newest first", () => {
    const { db, session } = seeded();
    session("old", "ended", OUT);
    session("a", "ended", "2026-11-08T23:00:00.000Z", "night job");
    session("b", "ended", "2026-11-08T23:30:00.000Z");
    session("live", "running", "2026-11-08T23:40:00.000Z");
    const digest = activitySince({ db }, SINCE);
    expect([digest.sessions.items.map((s) => s.id), digest.sessions.total]).toEqual([
      ["b", "a"],
      2,
    ]);
    expect(digest.sessions.items[1]).toEqual({
      id: "a",
      name: "night job",
      cwd: "/r",
      at: "2026-11-08T23:00:00.000Z",
    });
  });

  test("the cards that are in review since the time, not older ones or other columns", () => {
    const { db, card } = seeded();
    card("in", "review", IN);
    card("old", "review", OUT);
    card("other", "in_progress", IN);
    const digest = activitySince({ db }, SINCE);
    expect(digest.reviewCards.items.map((c) => [c.cardId, c.projectId, c.title, c.at])).toEqual([
      ["in", "p1", "title in", IN],
    ]);
  });

  test("a PR merged, or open with failing checks, since the time; a passing or older one is not", () => {
    const { db, card } = seeded();
    card("merged", "done", IN, {
      url: "https://x/pr/1",
      state: "merged",
      checks: "passing",
      doneAt: IN,
    });
    card("failing", "review", IN, { url: "https://x/pr/2", state: "open", checks: "failing" });
    card("passing", "review", IN, { url: "https://x/pr/3", state: "open", checks: "passing" });
    card("older", "done", OUT, { url: "https://x/pr/4", state: "merged", doneAt: OUT });
    // Merged long ago, edited since: the edit moves updated_at, but it did not merge in the absence.
    card("edited", "done", IN, { url: "https://x/pr/5", state: "merged", doneAt: OUT });
    const digest = activitySince({ db }, SINCE);
    expect(
      digest.prs.items
        .toSorted((a, b) => a.cardId.localeCompare(b.cardId))
        .map((p) => [p.cardId, p.prUrl, p.outcome]),
    ).toEqual([
      ["failing", "https://x/pr/2", "checks-failed"],
      ["merged", "https://x/pr/1", "merged"],
    ]);
  });

  test("the failed workflow runs that ended since the time, with their reason", () => {
    const { db, card, run } = seeded();
    card("c", "waiting", IN);
    run("r1", "c", "failed", IN, {
      text: "stopped: raw error text with /secret/path",
      key: "run.budget",
      params: { limit: 5 },
    });
    run("r2", "c", "failed", OUT);
    run("r3", "c", "done", IN);
    run("r4", "c", "running", null);
    const digest = activitySince({ db }, SINCE);
    expect(digest.failedRuns.items).toEqual([
      {
        runId: "r1",
        cardId: "c",
        workflowName: "ship",
        reasonKey: "run.budget",
        reasonParams: { limit: 5 },
        at: IN,
      },
    ]);
  });

  test("each list returns at most the limit but counts them all", () => {
    const { db, session } = seeded();
    for (let i = 0; i < 200; i += 1) {
      session(`s${i}`, "ended", `2026-11-08T23:${String(i % 60).padStart(2, "0")}:00.000Z`);
    }
    const digest = activitySince({ db }, SINCE, 7);
    expect([digest.sessions.items.length, digest.sessions.total]).toEqual([7, 200]);
    const defaults = activitySince({ db }, SINCE);
    expect(defaults.sessions.items.length).toBe(20);
  });

  test("the quota windows come from the reader when the host has one, none otherwise", () => {
    const { db } = seeded();
    const windows: QuotaWindow[] = [
      {
        window: "five_hour",
        utilization: 0.62,
        status: "allowed",
        resetsAt: null,
        readAt: IN,
      },
    ];
    const withQuota = activitySince({ db, quota: () => windows }, SINCE);
    const without = activitySince({ db }, SINCE);
    expect([withQuota.quota, without.quota]).toEqual([
      [{ window: "five_hour", utilization: 0.62 }],
      [],
    ]);
  });

  test("it writes nothing, in any table", () => {
    const { db, session, card, run } = seeded();
    session("a", "ended", IN);
    card("c", "review", IN);
    run("r", "c", "failed", IN);
    const changes = () => (db.query("SELECT total_changes() AS n").get() as { n: number }).n;
    const before = changes();
    activitySince({ db }, SINCE);
    expect(changes()).toBe(before);
  });
});
