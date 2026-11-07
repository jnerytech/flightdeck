import { z } from "zod";
import type { BoardColumn, Card } from "./index.ts";

/** What a column can ask of a card before it gets there (issue #78). */
export const ContractCheck = z.enum(["criteria", "pr", "checks"]);
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
export type ContractNeed = "criteria" | "pr" | "checksPending" | "checksFailing";

export type ContractOverrides = Partial<Record<BoardColumn, ColumnContract>>;

/** The contracts of the columns when a project sets none; a column not listed asks nothing. */
export const DEFAULT_CONTRACTS: ContractOverrides = {};

export function contractOf(
  _column: BoardColumn,
  _overrides: ContractOverrides = {},
): ColumnContract | null {
  return { enforce: "hint", checks: [] };
}

export function missingFor(
  _column: BoardColumn,
  _card: Pick<Card, "description" | "prUrl" | "checksState">,
  _overrides: ContractOverrides = {},
): ContractNeed[] {
  return ["criteria"];
}
