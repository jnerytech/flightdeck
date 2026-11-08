import type { Database } from "bun:sqlite";
import type { Budget, BudgetInput, QuotaBudgetInput, QuotaState } from "@flightdeck/protocol";
import { FlightdeckError, featureOff } from "../errors.ts";
import type { Timers } from "../quota/quota.ts";
import { localDay } from "../quota/usage.ts";
import { ulid } from "../ulid.ts";

export interface BudgetsOptions {
  db: Database;
  /** Milliseconds now. */
  now?: () => number;
  /** `YYYY-MM-DD` of an instant in the host's time zone. */
  day?: (ms: number) => string;
  timers?: Timers;
  /** The plan quota: what a window budget measures (issue #1248). */
  quota?: { state(): QuotaState; watch(listener: (state: QuotaState) => void): () => void };
  /** How often the period is checked for a turn of the day or month; 60 s when absent. */
  checkMs?: number;
}

/** A budget after a change; `threshold` when one was just crossed. */
export interface BudgetUpdate {
  budget: Budget;
  threshold: number | null;
  removed: boolean;
}

/** Alerts go out once per period at each of these fractions of the limit. */
const THRESHOLDS = [0.5, 0.8, 1] as const;

const CHECK_MS = 60_000;

const HOUR_MS = 3_600_000;
/** How long each plan quota window lasts: the span before its reset that its budgets look at. */
const WINDOW_MS: Partial<Record<Budget["period"], number>> = {
  five_hour: 5 * HOUR_MS,
  seven_day: 7 * 24 * HOUR_MS,
};

const iso = (ms: number) => new Date(ms).toISOString();

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Row {
  id: string;
  scope: Budget["scope"];
  project_key: string | null;
  period: Budget["period"];
  limit_usd: number;
  limit_pct: number | null;
  action: Budget["action"];
  created_at: string;
}

/** What makes news besides a threshold: a new period, or the queue starting or stopping. */
const signature = (budget: Budget) =>
  `${budget.periodKey}|${budget.action === "queue" && budget.fraction >= 1}`;

/**
 * Limits of the host and its projects: dollars per day or month in the host's time zone, or a
 * share of a plan quota window (issue #1248). The estimated cost of every origin counts; alerts
 * fire at 50%, 80% and 100% of the limit once per period, and a window's period is the window.
 */
export class Budgets {
  private readonly db: Database;
  private readonly now: () => number;
  private readonly day: (ms: number) => string;
  private readonly timers: Timers;
  private readonly watchers = new Set<(update: BudgetUpdate) => void>();
  /** The signature last announced of each budget. */
  private readonly seen = new Map<string, string>();
  private timer: unknown = null;
  private started = false;
  private unwatchQuota: (() => void) | null = null;

  constructor(readonly opts: BudgetsOptions) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
    this.day = opts.day ?? localDay;
    this.timers = opts.timers ?? realTimers;
    // Back from a restart, the current state is not news.
    for (const row of this.rows()) this.seen.set(row.id, signature(this.state(row)));
  }

  list(): Budget[] {
    return this.rows().map((row) => this.state(row));
  }

  /** Creates a dollar budget, or changes the one with `input.id` (its creation date stays). */
  set(input: BudgetInput): Budget {
    return this.save({
      id: input.id,
      scope: input.scope,
      projectKey: input.projectKey,
      period: input.period,
      limit: input.limitUsd,
      pct: null,
      action: input.action,
    });
  }

  /** The same for a budget in terms of a quota window: its period is the window. */
  setWindow(input: QuotaBudgetInput): Budget {
    if (!this.opts.quota) throw featureOff("quotaBudgets");
    return this.save({
      id: input.id,
      scope: input.scope,
      projectKey: input.projectKey,
      period: input.window,
      limit: 0,
      pct: input.limitPct,
      action: input.action,
    });
  }

  private save(input: {
    id?: string;
    scope: Budget["scope"];
    projectKey?: string;
    period: Budget["period"];
    limit: number;
    pct: number | null;
    action: Budget["action"];
  }): Budget {
    if (input.scope === "project" && !input.projectKey) {
      throw new FlightdeckError(
        "bad_request",
        "a project budget needs a projectKey",
        "budget_needs_project",
      );
    }
    const projectKey = input.scope === "project" ? (input.projectKey as string) : null;
    const fields = {
      scope: input.scope,
      key: projectKey,
      period: input.period,
      limit: input.limit,
      pct: input.pct,
      action: input.action,
    };
    let id = input.id;
    if (id) {
      this.row(id);
      this.db
        .query(
          `UPDATE budgets SET scope = $scope, project_key = $key, period = $period,
             limit_usd = $limit, limit_pct = $pct, action = $action WHERE id = $id`,
        )
        .run({ id, ...fields });
    } else {
      id = ulid(this.now());
      this.db
        .query(
          `INSERT INTO budgets (id, scope, project_key, period, limit_usd, limit_pct, action, created_at)
           VALUES ($id, $scope, $key, $period, $limit, $pct, $action, $at)`,
        )
        .run({ id, at: new Date(this.now()).toISOString(), ...fields });
    }
    const { budget, threshold } = this.check(this.row(id));
    this.announce({ budget, threshold, removed: false });
    this.arm();
    return budget;
  }

  remove(id: string): void {
    const budget = this.state(this.row(id));
    this.db.query("DELETE FROM budgets WHERE id = ?").run(id);
    this.db.query("DELETE FROM budget_alerts WHERE budget_id = ?").run(id);
    this.seen.delete(id);
    this.announce({ budget, threshold: null, removed: true });
    this.arm();
  }

  watch(listener: (update: BudgetUpdate) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  /** Spending again: crossed thresholds alert, a new period or a higher limit releases. */
  evaluate(): void {
    for (const row of this.rows()) {
      const { budget, threshold } = this.check(row);
      if (threshold !== null || this.seen.get(row.id) !== signature(budget)) {
        this.announce({ budget, threshold, removed: false });
      }
    }
  }

  /** A `queue` budget of the host or of this project is at 100%: its new cards wait. */
  blocked(projectKey: string): boolean {
    return this.rows().some(
      (row) =>
        row.action === "queue" &&
        (row.scope === "host" || row.project_key === projectKey) &&
        this.state(row).fraction >= 1,
    );
  }

  /** The period check, every `checkMs`, for as long as there is a budget to check. */
  start(): void {
    this.started = true;
    // A new reading of the plan quota is spending too: a window budget may have crossed.
    this.unwatchQuota ??= this.opts.quota?.watch(() => this.evaluate()) ?? null;
    this.arm();
  }

  stop(): void {
    this.started = false;
    this.unwatchQuota?.();
    this.unwatchQuota = null;
    this.arm();
  }

  private arm(): void {
    const wanted = this.started && this.db.query("SELECT 1 FROM budgets LIMIT 1").get() !== null;
    if (!wanted) {
      if (this.timer !== null) this.timers.clear(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer !== null) return;
    const tick = () => {
      this.evaluate();
      this.timer = this.timers.set(tick, this.opts.checkMs ?? CHECK_MS);
    };
    this.timer = this.timers.set(tick, this.opts.checkMs ?? CHECK_MS);
  }

  private rows(): Row[] {
    return this.db.query<Row, []>("SELECT * FROM budgets ORDER BY rowid").all();
  }

  private row(id: string): Row {
    const row = this.db.query<Row, [string]>("SELECT * FROM budgets WHERE id = ?").get(id);
    if (!row) {
      throw new FlightdeckError("not_found", `budget ${id} does not exist`, "budget_not_found", {
        id,
      });
    }
    return row;
  }

  private announce(update: BudgetUpdate): void {
    if (!update.removed) this.seen.set(update.budget.id, signature(update.budget));
    for (const watcher of this.watchers) watcher(update);
  }

  /** The budget now, with the thresholds it just crossed recorded; the highest one returned. */
  private check(row: Row): { budget: Budget; threshold: number | null } {
    const budget = this.state(row);
    const fresh = THRESHOLDS.filter((t) => budget.fraction >= t && !budget.crossed.includes(t));
    const insert = this.db.query(
      "INSERT INTO budget_alerts (budget_id, period, threshold, at) VALUES (?, ?, ?, ?)",
    );
    const at = new Date(this.now()).toISOString();
    for (const threshold of fresh) insert.run(row.id, budget.periodKey, threshold, at);
    return {
      budget: { ...budget, crossed: [...budget.crossed, ...fresh].sort((a, b) => a - b) },
      threshold: fresh.at(-1) ?? null,
    };
  }

  private state(row: Row): Budget {
    const { periodKey, spentUsd, spentPct, estimated, fraction } = this.spent(row);
    const crossed = this.db
      .query<{ threshold: number }, [string, string]>(
        "SELECT threshold FROM budget_alerts WHERE budget_id = ? AND period = ? ORDER BY threshold",
      )
      .all(row.id, periodKey)
      .map((r) => r.threshold);
    return {
      id: row.id,
      scope: row.scope,
      projectKey: row.project_key,
      period: row.period,
      limitUsd: row.limit_usd,
      limitPct: row.limit_pct,
      action: row.action,
      createdAt: row.created_at,
      periodKey,
      spentUsd,
      spentPct,
      estimated,
      fraction,
      crossed,
    };
  }

  /** What the budget's scope has used in its current period, and how much of the limit that is. */
  private spent(row: Row) {
    const span = WINDOW_MS[row.period];
    if (span === undefined || row.limit_pct === null) return this.spentUsd(row);
    return this.spentShare(row, span, row.limit_pct);
  }

  private spentUsd(row: Row) {
    const today = this.day(this.now());
    const periodKey = row.period === "day" ? today : today.slice(0, 7);
    // `day >= p AND day < p || '~'` is every day that starts with the period ('~' sorts after the
    // digits and the dash), a range of the index on the day instead of a scan of the entries.
    const { spent } = this.db
      .query(
        `SELECT TOTAL(cost_usd) AS spent FROM usage_entries
         WHERE day >= $period AND day < $period || '~' AND ($key IS NULL OR project_key = $key)`,
      )
      .get({ period: periodKey, key: row.project_key }) as { spent: number };
    return {
      periodKey,
      spentUsd: spent,
      spentPct: null,
      estimated: false,
      fraction: spent / row.limit_usd,
    };
  }

  /**
   * A window budget: the host's share is the window's utilization; a project's is that times its
   * part of the estimated cost since the window began (the plan does not say who used it, so the
   * budget says it is an estimate). No reading of the window: nothing used, nothing alerts.
   */
  private spentShare(row: Row, span: number, limitPct: number) {
    // A reading with no reset has no period to keep the alerts in: it counts as no reading.
    const reading = this.opts.quota
      ?.state()
      .windows.find((w) => w.window === row.period && w.resetsAt !== null);
    // The reset to the minute: the CLI may round it differently between readings, and that is the
    // same window, not a new period that would alert again.
    const reset = reading?.resetsAt
      ? Math.round(Date.parse(reading.resetsAt) / 60_000) * 60_000
      : null;
    const periodKey = reset === null ? "unread" : iso(reset);
    const now = this.now();
    const from = (reset ?? now) - span;
    const { total, scoped } = this.db
      .query(
        `SELECT TOTAL(cost_usd) AS total,
                TOTAL(CASE WHEN $key IS NULL OR project_key = $key THEN cost_usd ELSE 0 END) AS scoped
         FROM usage_entries
         WHERE day >= $fromDay AND day <= $toDay AND at >= $from AND at <= $to`,
      )
      // The day range lets the query use the index on the day; `at` is the exact edge.
      .get({
        key: row.project_key,
        from: iso(from),
        to: iso(now),
        fromDay: this.day(from),
        toDay: this.day(now),
      }) as {
      total: number;
      scoped: number;
    };
    // A plan reading is a share of 0 to 1; the CLI's `1e999` or a NaN must not reach the math.
    const raw = reading?.utilization ?? 0;
    const utilization = Number.isNaN(raw) ? 0 : Math.min(Math.max(raw, 0), 1);
    const estimated = row.project_key !== null;
    const share = estimated ? (total > 0 ? scoped / total : 0) : 1;
    const spentPct = utilization * share;
    return { periodKey, spentUsd: scoped, spentPct, estimated, fraction: spentPct / limitPct };
  }
}
