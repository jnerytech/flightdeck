import {
  type BoardColumn,
  type Card,
  type ColumnContract,
  type ContractNeed,
  type ContractOverrides,
  missingFor as cardMissing,
  contractOf as columnContract,
} from "@flightdeck/protocol";

/** What a card still lacks for a column, as a reader would say it. */
export type Need = ContractNeed;

/**
 * What a column asks of a card (issue #78): the project's own contract, else the default. The
 * daemon keeps the project's and enforces it on a person's move; the app asks first and says so.
 */
export function contractOf(
  column: BoardColumn,
  overrides: ContractOverrides = {},
): ColumnContract | null {
  return columnContract(column, overrides);
}

/** What `card` lacks for `column`; nothing when the column asks nothing or the card has it all. */
export function missingFor(
  column: BoardColumn,
  card: Card,
  overrides: ContractOverrides = {},
): Need[] {
  return cardMissing(column, card, overrides);
}

export interface Lacking {
  card: Card;
  needs: Need[];
}

/**
 * The cards a person's move to `column` should ask about: the ones that are not there yet, lack
 * something, and go to a column that confirms. Anything else moves with no question.
 */
export function askAbout(
  column: BoardColumn,
  cards: readonly Card[],
  overrides: ContractOverrides = {},
): Lacking[] {
  if (contractOf(column, overrides)?.enforce !== "confirm") return [];
  return cards
    .filter((card) => card.column !== column)
    .map((card) => ({ card, needs: missingFor(column, card, overrides) }))
    .filter((lacking) => lacking.needs.length > 0);
}

/** What any of `cards` would lack in `column`, each once: the line a dragged card's target shows. */
export function dragNeeds(
  column: BoardColumn,
  cards: readonly Card[],
  overrides: ContractOverrides = {},
): Need[] {
  const needs = cards
    .filter((card) => card.column !== column)
    .flatMap((card) => missingFor(column, card, overrides));
  return [...new Set(needs)];
}

/**
 * What a card lacks for starting it (issue #78): the acceptance criteria that In progress asks
 * for. Starting asks about nothing else, and a project that sets In progress with no `criteria`
 * is never asked.
 */
export function startNeeds(card: Card, overrides: ContractOverrides = {}): Need[] {
  return missingFor("in_progress", card, overrides).filter((need) => need === "criteria");
}
