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

/** Adds the figures of the same project on several hosts; weeks add by position. */
export function mergePeriods(_periods: readonly RoiPeriod[]): RoiPeriod {
  return { ...EMPTY_PERIOD, cards: 99 };
}

export function figures(_period: RoiPeriod, _money: RoiMoney): Figures {
  return {
    agentsCostUsd: 99,
    planShareUsd: 99,
    reviewCostUsd: 99,
    costUsd: 99,
    cards: 99,
    prsMerged: 99,
    costPerCard: 99,
    costPerPr: 99,
    hours: 99,
    valueUsd: 99,
    roi: 99,
    reworkShare: 99,
    fixRoundsPerPr: 99,
    derivation: [],
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

/** Did the team deliver more: the counts of cards done in the period against the one before. */
export function compare(_current: RoiPeriod, _previous: RoiPeriod): Comparison {
  return {
    verdict: "none",
    deltaPercent: 0,
    costPerItem: 0,
    previousCostPerItem: 0,
    costPerItemMoved: "same",
  };
}

/** The dictionary key and variables of the headline sentence. */
export function headline(
  _current: RoiPeriod,
  _previous: RoiPeriod,
): { key: string; vars: Record<string, string | number> } {
  return { key: "", vars: {} };
}

export type { RoiWeek };
