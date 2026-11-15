import type { FixRound } from "./fix-round.ts";

/** The limits a project sets on the rounds that fix a watched PR. */
export interface RoundLimits {
  maxTurns: number | null;
  budgetUsd: number | null;
  dailyUsd: number | null;
}

/** The rounds that count against the limits: the last `sinceStart` ones, those since Vigiar was last turned on. */
export function countedRounds(all: FixRound[], sinceStart: number): FixRound[] {
  return all.slice(all.length - sinceStart);
}

/** The card's rounds used up: the reason with each round, or null while some are left. */
export function roundsUsedUp(done: FixRound[], max: number): string | null {
  if (done.length < max) return null;
  const list = done.map(
    (r) => `round ${r.n}: ${r.status}` + (r.summary ? " (" + r.summary.split("\n")[0] + ")" : ""),
  );
  return `limit of ${max} rounds reached — ${list.join("; ")}`;
}

/**
 * The turns, the cost of this PR and the cost of the project's day against their limits: the
 * reason one is used up, or null. `dayCost` is read only when a daily limit is set.
 */
export function spendLimit(
  done: FixRound[],
  limits: RoundLimits,
  dayCost: () => number,
): string | null {
  const turns = done.reduce((sum, r) => sum + r.turns, 0);
  if (limits.maxTurns !== null && turns >= limits.maxTurns) {
    return `${turns} of ${limits.maxTurns} turns used on this PR`;
  }
  const cost = done.reduce((sum, r) => sum + r.costUsd, 0);
  if (limits.budgetUsd !== null && cost >= limits.budgetUsd) {
    return `US$ ${cost.toFixed(2)} of US$ ${limits.budgetUsd.toFixed(2)} spent on this PR`;
  }
  if (limits.dailyUsd === null) return null;
  const day = dayCost();
  if (day >= limits.dailyUsd) {
    return `US$ ${day.toFixed(2)} of US$ ${limits.dailyUsd.toFixed(2)} per day spent by this project's rounds`;
  }
  return null;
}
