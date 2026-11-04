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
  people: Person[],
  summaries: Array<{ hostId: string; result: RoiSummaryResult }>,
): PersonRow[] {
  return [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => {
      let tokens = 0;
      let costUsd = 0;
      let cards = 0;
      let prsMerged = 0;
      for (const { hostId, result } of summaries) {
        if (!person.hostIds.includes(hostId)) continue;
        for (const { current } of result.projects) {
          tokens += current.tokens;
          costUsd += current.costUsd;
          cards += current.cards;
          prsMerged += current.prsMerged;
        }
      }
      return {
        person,
        tokens,
        costUsd,
        cards,
        prsMerged,
        tokensPerCard: cards > 0 ? tokens / cards : null,
        tokenShare: person.tokenLimit ? tokens / person.tokenLimit : null,
        costShare: person.costLimit ? costUsd / person.costLimit : null,
      };
    });
}

export interface HumanTokens {
  unit: "plain" | "thousand" | "million";
  value: string;
}

/** 3,100,000 reads "3.1" million, and so does 442,857 ("0.44"): a million is the unit from 100,000 up; at most two decimals, none when they would be zeros. */
export function humanTokens(tokens: number): HumanTokens {
  const [unit, divisor] =
    tokens >= 100_000
      ? (["million", 1_000_000] as const)
      : tokens >= 1_000
        ? (["thousand", 1_000] as const)
        : (["plain", 1] as const);
  return { unit, value: String(Number((tokens / divisor).toFixed(2))) };
}
