import { afterEach, describe, expect, test } from "bun:test";
import type { SessionEventOf } from "@flightdeck/protocol";
import { UsageLedger } from "../src/quota/usage.ts";
import { newManager } from "./helpers.ts";

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
    const rows = l.summary(3).rows;
    expect(rows.map((r) => [r.day, r.projectKey, r.failedTurns, r.durationMs])).toEqual([
      ["2026-10-10", "p:/a", 1, 2000],
      ["2026-10-09", "p:/b", 0, 3000],
    ]);
  });

  test("a store that already had days before the columns keeps them, counted as no failures and no time", () => {
    const ctx = newManager();
    ctx.store.db
      .query(
        "INSERT INTO usage_daily (day, project_key, cost_usd, input_tokens, output_tokens, turns) VALUES ('2026-10-10', 'old', 1, 2, 3, 4)",
      )
      .run();
    const l = new UsageLedger({ db: ctx.store.db, projectKey: (c) => c, now: () => NOW, day: utc });
    expect(l.summary(1).rows[0]).toMatchObject({ turns: 4, failedTurns: 0, durationMs: 0 });
  });
});
