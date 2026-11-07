import type { BoardColumn, Card } from "@flightdeck/protocol";

/** What a column can ask of a card before it gets there (issue #78). */
export type Check = "criteria" | "pr" | "checks";

/** What a card still lacks for a column, as a reader would say it. */
export type Need = "criteria" | "pr" | "checksPending" | "checksFailing";

/**
 * How a column holds a card to its contract: `confirm` asks before a person's move and lets them
 * go on, `hint` only says what is missing.
 */
export type Enforce = "confirm" | "hint";

export interface Contract {
  enforce: Enforce;
  checks: readonly Check[];
}

/**
 * The contracts of the board's columns; a column not listed asks nothing. Starting a card is one
 * move, so In progress only says what is missing. Done asks nothing yet: many cards end with no PR.
 */
const CONTRACTS: Partial<Record<BoardColumn, Contract>> = {
  in_progress: { enforce: "hint", checks: ["criteria"] },
  review: { enforce: "confirm", checks: ["pr", "checks"] },
};

export function contractOf(column: BoardColumn): Contract | null {
  return CONTRACTS[column] ?? null;
}

/** A checklist item in the description is what the card calls its acceptance criteria. */
const CHECKLIST_ITEM = /^\s*[-*]\s+\[[ xX]\]\s/m;

/** What `card` lacks for `column`; nothing when the column asks nothing or the card has it all. */
export function missingFor(column: BoardColumn, card: Card): Need[] {
  const needs: Need[] = [];
  for (const check of contractOf(column)?.checks ?? []) {
    if (check === "criteria" && !CHECKLIST_ITEM.test(card.description)) needs.push("criteria");
    if (check === "pr" && !card.prUrl) needs.push("pr");
    // Checks belong to a PR. A repository with none reports no state: that is not the card's fault.
    if (check === "checks" && card.prUrl) {
      if (card.checksState === "pending") needs.push("checksPending");
      if (card.checksState === "failing") needs.push("checksFailing");
    }
  }
  return needs;
}

export interface Lacking {
  card: Card;
  needs: Need[];
}

/**
 * The cards a person's move to `column` should ask about: the ones that are not there yet, lack
 * something, and go to a column that confirms. Anything else moves with no question.
 */
export function askAbout(column: BoardColumn, cards: readonly Card[]): Lacking[] {
  if (contractOf(column)?.enforce !== "confirm") return [];
  return cards
    .filter((card) => card.column !== column)
    .map((card) => ({ card, needs: missingFor(column, card) }))
    .filter((lacking) => lacking.needs.length > 0);
}

/** What any of `cards` would lack in `column`, each once: the line a dragged card's target shows. */
export function dragNeeds(column: BoardColumn, cards: readonly Card[]): Need[] {
  const needs = cards
    .filter((card) => card.column !== column)
    .flatMap((card) => missingFor(column, card));
  return [...new Set(needs)];
}
