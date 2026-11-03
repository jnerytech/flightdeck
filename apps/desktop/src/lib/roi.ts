/**
 * Phase 36: the ROI arithmetic, on the app's side. The hosts answer counts, tokens and the cost the
 * agents ran up; the rate, the plan price and the billed amount are typed here and never leave the
 * app. Every figure carries how it was made, and what is an estimate says so.
 */
import type { RoiPeriod, RoiWeek } from "@flightdeck/protocol";

export const EMPTY_PERIOD: RoiPeriod = {
  costUsd: 0,
  tokens: 0,
  cards: 0,
  planned: 0,
  unplanned: 0,
  prsMerged: 0,
  plannedPrs: 0,
  unplannedPrs: 0,
  issuesResolved: 0,
  fixRounds: 0,
  fixCostUsd: 0,
  hours: 0,
  cardsWithoutEstimate: 0,
  decisions: 0,
  waitedSeconds: 0,
  outsideCardsUsd: 0,
  approxCards: 0,
  weeks: [],
};

/** What the person typed that turns delivered work into money. All optional. */
export interface RoiMoney {
  /** US$ per hour; null when none is set for the project, its client or the app. */
  rate: number | null;
  /** The amount billed for the period, typed per client and month. */
  billed: number | null;
  /** This project's share of the plan price for the period, in US$. */
  planShareUsd: number | null;
  countReview: boolean;
  /** The most one decision counts, in seconds. */
  reviewCapSeconds: number;
}

export interface Figures {
  agentsCostUsd: number;
  planShareUsd: number;
  reviewCostUsd: number;
  /** What the period cost: the agents, the plan's share and the review time when counted. */
  costUsd: number;
  cards: number;
  prsMerged: number;
  costPerCard: number | null;
  costPerPr: number | null;
  hours: number;
  /** Hours times the rate, plus what was billed; null without a rate or a billed amount. */
  valueUsd: number | null;
  /** (value - cost) / cost; null unless the cost is above zero and a value exists. */
  roi: number | null;
  /** Fix cost over cost, and fix rounds per merged PR. */
  reworkShare: number | null;
  fixRoundsPerPr: number | null;
  /** How each figure was made: a dictionary key and the numbers, one line per figure. */
  derivation: Array<{ key: string; vars: Record<string, string | number> }>;
}

const money2 = (n: number) => n.toFixed(2);

const SUMMED = [
  "costUsd",
  "tokens",
  "cards",
  "planned",
  "unplanned",
  "prsMerged",
  "plannedPrs",
  "unplannedPrs",
  "issuesResolved",
  "fixRounds",
  "fixCostUsd",
  "hours",
  "cardsWithoutEstimate",
  "decisions",
  "waitedSeconds",
  "outsideCardsUsd",
  "approxCards",
] as const;

/** Adds the figures of the same project on several hosts; weeks add by position. */
export function mergePeriods(periods: readonly RoiPeriod[]): RoiPeriod {
  const merged: RoiPeriod = { ...EMPTY_PERIOD, weeks: [] };
  for (const period of periods) {
    for (const key of SUMMED) merged[key] += period[key];
    period.weeks.forEach((week, i) => {
      const at = merged.weeks[i];
      if (!at) {
        merged.weeks[i] = { ...week };
        return;
      }
      at.costUsd += week.costUsd;
      at.tokens += week.tokens;
      at.cards += week.cards;
      at.planned += week.planned;
      at.unplanned += week.unplanned;
      at.prsMerged += week.prsMerged;
    });
  }
  return merged;
}

export function figures(period: RoiPeriod, money: RoiMoney): Figures {
  const agentsCostUsd = period.costUsd;
  const planShareUsd = money.planShareUsd ?? 0;
  // Each decision counts at most the cap: the totals give the most it can come to.
  const reviewSeconds = Math.min(period.waitedSeconds, period.decisions * money.reviewCapSeconds);
  const reviewCostUsd =
    money.countReview && money.rate !== null ? (reviewSeconds / 3600) * money.rate : 0;
  const costUsd = agentsCostUsd + planShareUsd + reviewCostUsd;
  const hoursValue = money.rate === null ? null : period.hours * money.rate;
  const valueUsd =
    hoursValue === null && money.billed === null ? null : (hoursValue ?? 0) + (money.billed ?? 0);
  const roi = costUsd > 0 && valueUsd !== null ? (valueUsd - costUsd) / costUsd : null;
  const costPerCard = period.cards > 0 ? costUsd / period.cards : null;
  const costPerPr = period.prsMerged > 0 ? costUsd / period.prsMerged : null;
  const derivation: Figures["derivation"] = [
    {
      key: "roiUi.derive.cost",
      vars: {
        total: money2(costUsd),
        agents: money2(agentsCostUsd),
        plan: money2(planShareUsd),
        review: money2(reviewCostUsd),
      },
    },
  ];
  if (costPerCard !== null) {
    derivation.push({
      key: "roiUi.derive.costPerCard",
      vars: { cost: money2(costUsd), n: period.cards, each: money2(costPerCard) },
    });
  }
  if (costPerPr !== null) {
    derivation.push({
      key: "roiUi.derive.costPerPr",
      vars: { cost: money2(costUsd), n: period.prsMerged, each: money2(costPerPr) },
    });
  }
  derivation.push({ key: "roiUi.derive.hours", vars: { hours: period.hours } });
  if (period.cardsWithoutEstimate > 0) {
    derivation.push({ key: "roiUi.derive.noEstimate", vars: { n: period.cardsWithoutEstimate } });
  }
  if (valueUsd !== null) {
    derivation.push({
      key: "roiUi.derive.value",
      vars: {
        hours: period.hours,
        rate: money2(money.rate ?? 0),
        billed: money2(money.billed ?? 0),
        value: money2(valueUsd),
      },
    });
  }
  if (roi !== null && valueUsd !== null) {
    derivation.push({
      key: "roiUi.derive.roi",
      vars: { value: money2(valueUsd), cost: money2(costUsd), roi: roi.toFixed(1) },
    });
  }
  return {
    agentsCostUsd,
    planShareUsd,
    reviewCostUsd,
    costUsd,
    cards: period.cards,
    prsMerged: period.prsMerged,
    costPerCard,
    costPerPr,
    hours: period.hours,
    valueUsd,
    roi,
    reworkShare: costUsd > 0 ? period.fixCostUsd / costUsd : null,
    fixRoundsPerPr: period.prsMerged > 0 ? period.fixRounds / period.prsMerged : null,
    derivation,
  };
}

export type Verdict = "more" | "fewer" | "same" | "none";

export interface Comparison {
  verdict: Verdict;
  /** The change in delivered items, in percent; null when the previous period delivered nothing. */
  deltaPercent: number | null;
  costPerItem: number | null;
  previousCostPerItem: number | null;
  /** How the cost per item moved; null when either period has none. */
  costPerItemMoved: "lower" | "higher" | "same" | null;
}

/** Changes inside this share count as no change. */
const SAME = 0.05;

/** Did the team deliver more: the counts of cards done in the period against the one before. */
export function compare(current: RoiPeriod, previous: RoiPeriod): Comparison {
  const costPerItem = current.cards > 0 ? current.costUsd / current.cards : null;
  const previousCostPerItem = previous.cards > 0 ? previous.costUsd / previous.cards : null;
  let costPerItemMoved: Comparison["costPerItemMoved"] = null;
  if (costPerItem !== null && previousCostPerItem !== null) {
    const ratio =
      previousCostPerItem === 0 ? 0 : (costPerItem - previousCostPerItem) / previousCostPerItem;
    costPerItemMoved = Math.abs(ratio) <= SAME ? "same" : ratio < 0 ? "lower" : "higher";
  }
  if (current.cards === 0 && previous.cards === 0) {
    return {
      verdict: "none",
      deltaPercent: null,
      costPerItem,
      previousCostPerItem,
      costPerItemMoved,
    };
  }
  if (previous.cards === 0) {
    return {
      verdict: "more",
      deltaPercent: null,
      costPerItem,
      previousCostPerItem,
      costPerItemMoved,
    };
  }
  const change = (current.cards - previous.cards) / previous.cards;
  const verdict: Verdict = Math.abs(change) <= SAME ? "same" : change > 0 ? "more" : "fewer";
  return {
    verdict,
    deltaPercent: Math.round(change * 100),
    costPerItem,
    previousCostPerItem,
    costPerItemMoved,
  };
}

/** The dictionary key and variables of the headline sentence. */
export function headline(
  current: RoiPeriod,
  previous: RoiPeriod,
): { key: string; vars: Record<string, string | number> } {
  const c = compare(current, previous);
  if (c.verdict === "none")
    return { key: "roiUi.headline.none", vars: { cost: money2(current.costUsd) } };
  return {
    key: `roiUi.headline.${c.verdict}`,
    vars: {
      n: current.cards,
      planned: current.planned,
      unplanned: current.unplanned,
      cost: money2(current.costUsd),
      previous: previous.cards,
      moved: c.costPerItemMoved ?? "none",
    },
  };
}

export type { RoiWeek };
