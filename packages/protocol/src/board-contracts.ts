import { z } from "zod";
import type { BoardColumn, Card } from "./index.ts";

/** What a column can ask of a card before it gets there (issue #78). */
export const ContractCheck = z.enum(["criteria", "pr", "checks", "validation"]);
export type ContractCheck = z.infer<typeof ContractCheck>;

/**
 * How a column holds a card to its contract: `confirm` refuses a person's move unless they force
 * it, `hint` only says what is missing.
 */
export const ColumnContract = z.object({
  enforce: z.enum(["confirm", "hint"]),
  checks: z.array(ContractCheck),
});
export type ColumnContract = z.infer<typeof ColumnContract>;

/** What a card still lacks for a column, as a reader would say it. */
export type ContractNeed = "criteria" | "pr" | "checksPending" | "checksFailing" | "validation";

export type ContractOverrides = Partial<Record<BoardColumn, ColumnContract>>;

/**
 * The contracts of the columns when a project sets none; a column not listed asks nothing.
 * Starting a card is one move, so In progress only says what is missing. Done asks nothing yet:
 * many cards end with no PR.
 */
export const DEFAULT_CONTRACTS: ContractOverrides = {
  in_progress: { enforce: "hint", checks: ["criteria"] },
  review: { enforce: "confirm", checks: ["pr", "checks"] },
};

/** The contract a column holds cards to: the project's own, else the default, else none. */
export function contractOf(
  column: BoardColumn,
  overrides: ContractOverrides = {},
): ColumnContract | null {
  return overrides[column] ?? DEFAULT_CONTRACTS[column] ?? null;
}

/** A checklist item in the description is what the card calls its acceptance criteria. */
const CHECKLIST_ITEM = /^\s*[-*]\s+\[[ xX]\]\s/m;

type Lookable = Pick<Card, "description" | "prUrl" | "checksState" | "validationNote">;

/** A PR's checks only count once there is a PR; a repository with none reports no state at all. */
function checksNeeds(card: Lookable): ContractNeed[] {
  if (!card.prUrl) return [];
  if (card.checksState === "pending") return ["checksPending"];
  return card.checksState === "failing" ? ["checksFailing"] : [];
}

/** What each check asks of a card. */
const LACKING: Record<ContractCheck, (card: Lookable) => ContractNeed[]> = {
  criteria: (card) => (CHECKLIST_ITEM.test(card.description) ? [] : ["criteria"]),
  pr: (card) => (card.prUrl ? [] : ["pr"]),
  checks: checksNeeds,
  validation: (card) => (card.validationNote?.trim() ? [] : ["validation"]),
};

/** What `card` lacks for `column`; nothing when the column asks nothing or the card has it all. */
export function missingFor(
  column: BoardColumn,
  card: Lookable,
  overrides: ContractOverrides = {},
): ContractNeed[] {
  const checks = contractOf(column, overrides)?.checks ?? [];
  return checks.flatMap((check) => LACKING[check](card));
}
