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

/** What `card` lacks for `column`; nothing when the column asks nothing or the card has it all. */
export function missingFor(
  column: BoardColumn,
  card: Pick<Card, "description" | "prUrl" | "checksState" | "validationNote">,
  overrides: ContractOverrides = {},
): ContractNeed[] {
  const needs: ContractNeed[] = [];
  for (const check of contractOf(column, overrides)?.checks ?? []) {
    if (check === "criteria" && !CHECKLIST_ITEM.test(card.description)) needs.push("criteria");
    if (check === "pr" && !card.prUrl) needs.push("pr");
    if (check === "validation" && !card.validationNote?.trim()) needs.push("validation");
    // Checks belong to a PR. A repository with none reports no state: that is not the card's fault.
    if (check === "checks" && card.prUrl) {
      if (card.checksState === "pending") needs.push("checksPending");
      if (card.checksState === "failing") needs.push("checksFailing");
    }
  }
  return needs;
}

/** Why a spec path is refused, or null when it may be looked up in a worktree. Stub. */
export function specPathProblem(_path: string): string | null {
  return null;
}
