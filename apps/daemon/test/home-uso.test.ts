import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionEventOf } from "@flightdeck/protocol";
import { UsageLedger } from "../src/quota/usage.ts";
import { EventStore } from "../src/store/event-store.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { newManager, tempDir } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 15, 0);
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const turn = (
  isError: boolean,
  durationMs: number,
  costUsd = 0.1,
): SessionEventOf<"turn.result"> => ({
  type: "turn.result",
  subtype: isError ? "error_during_execution" : "success",
  isError,
  durationMs,
  costUsd,
  usage: { inputTokens: 10, outputTokens: 5 },
});

function ledger(at = NOW) {
  const ctx = newManager();
  return new UsageLedger({
    db: ctx.store.db,
    projectKey: (cwd) => `p:${cwd}`,
    now: () => at,
    day: utc,
  });
}

describe("home-uso: the ledger counts failed turns and the time they took", () => {
  test("a day's row has the turns that failed and the milliseconds all of them took", () => {
    const l = ledger();
    l.record("s1", "/a", turn(false, 4000));
    l.record("s2", "/a", turn(true, 1000));
    l.record("s3", "/a", turn(false, 7000));
    const [row] = l.summary(1).rows;
    expect(row).toMatchObject({ turns: 3, failedTurns: 1, durationMs: 12_000 });
  });

  test("each day and project keeps its own counts", () => {
    let at = NOW;
    const ctx = newManager();
    const l = new UsageLedger({
      db: ctx.store.db,
      projectKey: (cwd) => `p:${cwd}`,
      now: () => at,
      day: utc,
    });
    l.record("s1", "/a", turn(true, 2000));
    at -= DAY;
    l.record("s2", "/b", turn(false, 3000));
    at += DAY;
    const rows = l.summary(3).rows;
    expect(rows.map((r) => [r.day, r.projectKey, r.failedTurns, r.durationMs])).toEqual([
      ["2026-10-10", "p:/a", 1, 2000],
      ["2026-10-09", "p:/b", 0, 3000],
    ]);
  });

  test("a store that already had days before the columns keeps them, with the failures and the time unknown (HK-M1)", () => {
    const ctx = newManager();
    ctx.store.db
      .query(
        "INSERT INTO usage_daily (day, project_key, cost_usd, input_tokens, output_tokens, turns) VALUES ('2026-10-10', 'old', 1, 2, 3, 4)",
      )
      .run();
    const l = new UsageLedger({ db: ctx.store.db, projectKey: (c) => c, now: () => NOW, day: utc });
    const old = l.summary(1).rows[0] as Record<string, unknown>;
    expect(old).toMatchObject({ turns: 4 });
    expect("failedTurns" in old).toBe(false);
    expect("durationMs" in old).toBe(false);
    // A turn recorded on that day cannot make the old turns known: the day stays unknown.
    l.record("s1", "old", turn(true, 900));
    const same = l.summary(1).rows[0] as Record<string, unknown>;
    expect(same).toMatchObject({ turns: 5 });
    expect("failedTurns" in same).toBe(false);
  });

  test("a database from before the columns (0.36.1) is upgraded in place: its days survive, and new turns add to them", () => {
    const path = join(tempDir(), "events.db");
    const columns = MIGRATIONS.findIndex((sql) => sql.includes("ADD COLUMN failed_turns"));
    expect(columns).toBeGreaterThan(0);
    // The file as the last release left it: every migration before the new one, and a day with turns.
    const old = new Database(path, { create: true });
    for (const sql of MIGRATIONS.slice(0, columns)) old.exec(sql);
    old.exec(`PRAGMA user_version = ${columns}`);
    old.exec(
      "INSERT INTO usage_daily (day, project_key, cost_usd, input_tokens, output_tokens, turns) VALUES ('2026-10-10', 'p:old', 1.5, 20, 30, 6)",
    );
    old.close();
    const store = new EventStore(path);
    cleanups.push(() => store.close());
    expect(store.db.query("PRAGMA user_version").get()).toEqual({
      user_version: MIGRATIONS.length,
    });
    const l = new UsageLedger({
      db: store.db,
      projectKey: () => "p:old",
      now: () => NOW,
      day: utc,
    });
    expect(l.summary(1).rows).toEqual([
      {
        day: "2026-10-10",
        projectKey: "p:old",
        costUsd: 1.5,
        inputTokens: 20,
        outputTokens: 30,
        turns: 6,
      },
    ]);
    l.record("s1", "/a", turn(true, 2500, 0.5));
    // The same day and project: the old turns are still of unknown outcome and time.
    expect(l.summary(1).rows[0]).toEqual({
      day: "2026-10-10",
      projectKey: "p:old",
      costUsd: 2,
      inputTokens: 20,
      outputTokens: 30,
      turns: 7,
    });
    // Opening it again changes nothing: the migration ran once.
    store.close();
    const again = new EventStore(path);
    cleanups.push(() => again.close());
    expect(again.db.query("SELECT turns FROM usage_daily").get()).toEqual({ turns: 7 });
  });
});
