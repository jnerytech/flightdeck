import type { RoiSummaryResult } from "@flightdeck/protocol";
import type { Person } from "./roi-settings.ts";

export interface PersonRow {
  person: Person;
  tokens: number;
  costUsd: number;
  cards: number;
  prsMerged: number;
  /** Tokens over cards done; null with no card done. */
  tokensPerCard: number | null;
  /** Tokens used over the token limit, as a fraction; null without a limit. */
  tokenShare: number | null;
  costShare: number | null;
}

/** One row per person, ordered by name: delivery never decides the order. */
export function personRows(
  _people: Person[],
  _summaries: Array<{ hostId: string; result: RoiSummaryResult }>,
): PersonRow[] {
  return [];
}

export interface HumanTokens {
  unit: "plain" | "thousand" | "million";
  value: string;
}

/** 3,100,000 reads "3.1" million; at most two decimals, none when they would be zeros. */
export function humanTokens(_tokens: number): HumanTokens {
  return { unit: "plain", value: "" };
}
