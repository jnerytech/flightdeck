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
    /** `null` when no host gave costs: unknown, not zero. */
    totalUsd: number | null;
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
  tokens: { total: number | null; cacheRead: number | null; series: number[] };
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
  // A host in a time zone ahead of the app's already is on the next day: that day is the last one here.
  const last = days.at(-1) ?? "";
  const clamp = (day: string) => (day > last ? last : day);
  const byDay = input.costs.flatMap((c) => c.byDay).map((d) => ({ ...d, day: clamp(d.day) }));
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

  const rows = input.usage
    .flatMap((u) => u.rows)
    .map((r) => ({ ...r, day: clamp(r.day) }))
    .filter((r) => days.includes(r.day));
  const turnSeries = perDay(
    days,
    rows.map((r) => [r.day, r.turns]),
  );
  const total = sum(turnSeries);
  // One host that does not count failures makes the failed turns unknown for all of them.
  const counted = rows.every((r) => r.failedTurns !== undefined);
  const failed = counted ? sum(rows.map((r) => r.failedTurns ?? 0)) : null;
  // The averages use the days that know their failures and time: old days are unknown, not zero.
  const known = rows.filter((r) => r.failedTurns !== undefined && r.durationMs !== undefined);
  const knownTurns = sum(known.map((r) => r.turns));
  const costPerDay = perDay(
    days,
    rows.map((r) => [r.day, r.costUsd]),
  );

  const tokenKinds = input.costs.map((c) => c.totals.tokens);
  return {
    // No costs from any host is unknown, not a spend of nothing.
    spend: {
      totalUsd: input.costs.length === 0 ? null : sum(spendSeries),
      series: spendSeries,
      budget,
    },
    turns: {
      total,
      ok: failed === null ? total : total - failed,
      failed,
      series: turnSeries,
    },
    tokens: {
      total:
        input.costs.length === 0
          ? null
          : sum(
              tokenKinds.map(
                (t) => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h,
              ),
            ),
      cacheRead: input.costs.length === 0 ? null : sum(tokenKinds.map((t) => t.cacheRead)),
      series: perDay(
        days,
        byDay.map((d) => [d.day, d.tokens]),
      ),
    },
    average: {
      costPerTurnUsd: total === 0 ? null : sum(costPerDay) / total,
      turnMs: knownTurns === 0 ? null : sum(known.map((r) => r.durationMs ?? 0)) / knownTurns,
      successRate:
        knownTurns === 0
          ? null
          : (knownTurns - sum(known.map((r) => r.failedTurns ?? 0))) / knownTurns,
      series: costPerDay.map((cost, i) =>
        (turnSeries[i] ?? 0) === 0 ? 0 : cost / (turnSeries[i] as number),
      ),
    },
  };
}
