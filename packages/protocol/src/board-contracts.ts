import { z } from "zod";
import type { BoardColumn, Card } from "./index.ts";

/** What a column can ask of a card before it gets there (issue #78). */
export const ContractCheck = z.enum(["criteria", "pr", "checks", "validation", "spec"]);
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
export type ContractNeed =
  | "criteria"
  | "pr"
  | "checksPending"
  | "checksFailing"
  | "validation"
  | "spec";

/**
 * What the host found of a card's spec file (issue #78): where it looked, whether a file is there
 * and its first heading. The contents never travel.
 */
export const SpecState = z.object({
  path: z.string(),
  found: z.boolean(),
  heading: z.string().nullable(),
});
export type SpecState = z.infer<typeof SpecState>;

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
  card: Pick<
    Card,
    "description" | "prUrl" | "checksState" | "validationNote" | "specState" | "specPath" | "slug"
  >,
  overrides: ContractOverrides = {},
): ContractNeed[] {
  const needs: ContractNeed[] = [];
  for (const check of contractOf(column, overrides)?.checks ?? []) {
    if (check === "criteria" && !CHECKLIST_ITEM.test(card.description)) needs.push("criteria");
    if (check === "pr" && !card.prUrl) needs.push("pr");
    if (check === "validation" && !card.validationNote?.trim()) needs.push("validation");
    // What was found counts only for the path the card names now.
    if (
      check === "spec" &&
      !(card.specState?.found && card.specState.path === specExpectedPath(card))
    ) {
      needs.push("spec");
    }
    // Checks belong to a PR. A repository with none reports no state: that is not the card's fault.
    if (check === "checks" && card.prUrl) {
      if (card.checksState === "pending") needs.push("checksPending");
      if (card.checksState === "failing") needs.push("checksFailing");
    }
  }
  return needs;
}

/**
 * `con`, `nul`, `com1`… (with any extension) are devices to Windows, and spaces before the first
 * dot are trimmed there: a name that is either is not a plain file name.
 */
function isDeviceName(part: string): boolean {
  const stem = part.split(".")[0] ?? "";
  return stem !== stem.trimEnd() || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem);
}

/** The longest path a card can name for its spec. */
export const SPEC_PATH_MAX = 200;

/**
 * Why a spec path is refused, or null when it may be looked up in a worktree: a relative path of
 * plain segments to a Markdown file, with no `.`, `..` or empty segment and nothing a terminal
 * would act on. The host checks it again, and checks where it lands, before it opens anything.
 */
export function specPathProblem(path: string): string | null {
  if (path.length === 0 || path.length > SPEC_PATH_MAX) return "length";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\u0000-\u001f\u007f]/.test(path)) return "control";
  if (/^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) return "absolute";
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) return "segment";
  // Names Windows reads as something else: a stream (`:`), a name it trims, or a device.
  if (parts.some((part) => part.includes(":") || /[. ]$/.test(part))) return "windows";
  if (parts.some((part) => isDeviceName(part))) return "windows";
  return path.toLowerCase().endsWith(".md") ? null : "extension";
}

/** The path a card's spec is looked for at: the one it names, else `docs/specs/<slug>.md`. */
export function specExpectedPath(card: {
  specPath: string | null;
  slug: string | null;
}): string | null {
  return card.specPath ?? (card.slug ? `docs/specs/${card.slug}.md` : null);
}
