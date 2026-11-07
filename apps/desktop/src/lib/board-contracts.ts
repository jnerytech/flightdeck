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

/** The contracts of the board's columns; a column not listed asks nothing. */
export function contractOf(_column: BoardColumn): Contract | null {
  return null;
}

/** What `card` lacks for `column`; nothing when the column asks nothing or the card has it all. */
export function missingFor(_column: BoardColumn, _card: Card): Need[] {
  return [];
}
