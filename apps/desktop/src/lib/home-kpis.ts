import type { Budget, CostsSummary, UsageSummary } from "@flightdeck/protocol";

/** What Home reads: the last days of every host, and the budgets that are set. */
export interface HomeInput {
  /** `YYYY-MM-DD`, oldest first: the days the sparklines draw. */
  days: string[];
  /** One costs summary per host. */
  costs: CostsSummary[];
  /** One usage summary per host. */
  usage: UsageSummary[];
  budgets: Budget[];
}

export interface HomeKpis {
  spend: {
    totalUsd: number;
    series: number[];
    /** The month's host budgets together; `null` when none is set. */
    budget: { spentUsd: number; limitUsd: number } | null;
  };
  turns: {
    total: number;
    ok: number;
    /** `null` when a host does not count them (an older daemon). */
    failed: number | null;
    series: number[];
  };
  tokens: { total: number; cacheRead: number; series: number[] };
  average: {
    costPerTurnUsd: number | null;
    turnMs: number | null;
    successRate: number | null;
    series: number[];
  };
}

/** One number per day, oldest first, from `(day, value)` pairs; a day with none is 0. */
function perDay(days: string[], pairs: Iterable<[string, number]>): number[] {
  const sums = new Map<string, number>();
  for (const [day, value] of pairs) sums.set(day, (sums.get(day) ?? 0) + value);
  return days.map((day) => sums.get(day) ?? 0);
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function homeKpis(input: HomeInput): HomeKpis {
  const { days } = input;
  const byDay = input.costs.flatMap((c) => c.byDay);
  const spendSeries = perDay(
    days,
    byDay.map((d) => [d.day, d.costUsd]),
  );
  const monthly = input.budgets.filter((b) => b.scope === "host" && b.period === "month");
  const budget =
    monthly.length === 0
      ? null
      : {
          spentUsd: sum(monthly.map((b) => b.spentUsd)),
          limitUsd: sum(monthly.map((b) => b.limitUsd)),
        };

  const rows = input.usage.flatMap((u) => u.rows).filter((r) => days.includes(r.day));
  const turnSeries = perDay(
    days,
    rows.map((r) => [r.day, r.turns]),
  );
  const total = sum(turnSeries);
  // One host that does not count failures makes the failed turns unknown for all of them.
  const counted = rows.every((r) => r.failedTurns !== undefined);
  const failed = counted ? sum(rows.map((r) => r.failedTurns ?? 0)) : null;
  const timed = rows.every((r) => r.durationMs !== undefined);
  const costPerDay = perDay(
    days,
    rows.map((r) => [r.day, r.costUsd]),
  );

  const tokenKinds = input.costs.map((c) => c.totals.tokens);
  return {
    spend: { totalUsd: sum(spendSeries), series: spendSeries, budget },
    turns: {
      total,
      ok: failed === null ? total : total - failed,
      failed,
      series: turnSeries,
    },
    tokens: {
      total: sum(
        tokenKinds.map((t) => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h),
      ),
      cacheRead: sum(tokenKinds.map((t) => t.cacheRead)),
      series: perDay(
        days,
        byDay.map((d) => [d.day, d.tokens]),
      ),
    },
    average: {
      costPerTurnUsd: total === 0 ? null : sum(costPerDay) / total,
      turnMs: total === 0 || !timed ? null : sum(rows.map((r) => r.durationMs ?? 0)) / total,
      successRate: total === 0 || failed === null ? null : (total - failed) / total,
      series: costPerDay.map((cost, i) =>
        (turnSeries[i] ?? 0) === 0 ? 0 : cost / (turnSeries[i] as number),
      ),
    },
  };
}
