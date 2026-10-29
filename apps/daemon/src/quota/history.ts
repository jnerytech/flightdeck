import type { Database } from "bun:sqlite";
import type { QuotaHistory as QuotaHistoryResult } from "@flightdeck/protocol";
import type { QuotaReading } from "../runtime/types.ts";

export interface QuotaHistoryOptions {
  db: Database;
  /** Milliseconds now. */
  now?: () => number;
}

/** An equal reading of the same window within this long of the last sample is not stored. */
const SAME_READING_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;
/** The window "who used it" covers. */
const FIVE_HOUR = "five_hour";
const MINUTE_MS = 60_000;
/** A projection needs at least this many samples of the current window. */
const MIN_SAMPLES = 3;

interface SampleRow {
  utilization: number | null;
  status: string;
  resets_at: string | null;
  taken_at: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * When a linear fit of the samples reaches 100%: `null` when it never does (flat or falling) or
 * only after the window resets. Rounded to the minute, as the app shows it.
 */
function exhaustion(points: Array<{ t: number; u: number }>, resetsAt: number | null) {
  const n = points.length;
  // Times centred on their mean keep the fit precise with epoch milliseconds.
  const tMean = points.reduce((sum, p) => sum + p.t, 0) / n;
  const uMean = points.reduce((sum, p) => sum + p.u, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - tMean) * (p.u - uMean);
    den += (p.t - tMean) ** 2;
  }
  const slope = num / den;
  if (!(slope > 0)) return null;
  const at = Math.round((tMean + (1 - uMean) / slope) / MINUTE_MS) * MINUTE_MS;
  return resetsAt !== null && at >= resetsAt ? null : at;
}

/** Every reading of the plan quota, kept for its history and projection. */
export class QuotaHistory {
  private readonly db: Database;
  private readonly now: () => number;

  constructor(readonly opts: QuotaHistoryOptions) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
  }

  /** Stores the readings; one equal to the window's last sample of under 5 minutes ago is dropped. */
  sample(readings: readonly QuotaReading[]): void {
    const now = this.now();
    for (const reading of readings) {
      const resetsAt = reading.resetsAt === null ? null : iso(reading.resetsAt);
      const last = this.db
        .query<SampleRow, [string]>(
          "SELECT * FROM quota_samples WHERE window = ? ORDER BY taken_at DESC LIMIT 1",
        )
        .get(reading.window);
      const same =
        last !== null &&
        last.utilization === reading.utilization &&
        last.status === reading.status &&
        last.resets_at === resetsAt &&
        now - Date.parse(last.taken_at) < SAME_READING_MS;
      if (same) continue;
      this.db
        .query(
          "INSERT INTO quota_samples (window, utilization, resets_at, status, taken_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(reading.window, reading.utilization, resetsAt, reading.status, iso(now));
    }
  }

  /** The window's samples of the last `hours`, its projection and who used the 5-hour window. */
  history(window: string, hours: number): QuotaHistoryResult {
    const now = this.now();
    const rows = this.db
      .query<SampleRow, [string, string]>(
        "SELECT * FROM quota_samples WHERE window = ? AND taken_at >= ? ORDER BY taken_at",
      )
      .all(window, iso(now - hours * HOUR_MS));
    const last = rows.at(-1);
    const current = rows.filter(
      (r) => r.resets_at === (last?.resets_at ?? null) && r.utilization !== null,
    );
    const resetsAt = last?.resets_at ?? null;
    let projection: QuotaHistoryResult["projection"] = null;
    if (current.length >= MIN_SAMPLES) {
      const points = current.map((r) => ({
        t: Date.parse(r.taken_at),
        u: r.utilization as number,
      }));
      const at = exhaustion(points, resetsAt === null ? null : Date.parse(resetsAt));
      projection = { exhaustsAt: at === null ? null : iso(at), resetsAt, samples: current.length };
    }
    return {
      window,
      hours,
      samples: rows.map((r) => ({
        utilization: r.utilization,
        status: r.status,
        resetsAt: r.resets_at,
        takenAt: r.taken_at,
      })),
      projection,
      consumers: window === FIVE_HOUR ? this.consumers(resetsAt, now) : [],
    };
  }

  /** Each project's share of the estimated cost since the current 5-hour window began. */
  private consumers(resetsAt: string | null, now: number): QuotaHistoryResult["consumers"] {
    const start = (resetsAt === null ? now : Date.parse(resetsAt)) - 5 * HOUR_MS;
    const rows = this.db
      .query<{ projectKey: string; costUsd: number }, [string, string]>(
        `SELECT project_key AS projectKey, TOTAL(cost_usd) AS costUsd FROM usage_entries
         WHERE at >= ? AND at <= ? GROUP BY project_key HAVING costUsd > 0
         ORDER BY costUsd DESC, project_key`,
      )
      .all(iso(start), iso(now));
    const total = rows.reduce((sum, r) => sum + r.costUsd, 0);
    return rows.map((r) => ({ ...r, share: r.costUsd / total }));
  }
}
