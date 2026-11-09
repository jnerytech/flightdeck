import type { ReviewComment } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";

/**
 * The reviewer drafts still open on a card (#1446, the second-opinion review): the findings of the
 * review that nobody has sent, edited (which makes them the person's) or dismissed.
 */
export function openFindings(_comments: readonly ReviewComment[]): { open: number; high: number } {
  return { open: 0, high: 0 };
}

/**
 * The Open PR confirm's line: "2 reviewer findings not addressed (1 high)". Only when a blocker or
 * a high finding is still open; the PR opens all the same.
 */
export function findingsNote(_t: T, _comments: readonly ReviewComment[]): string | null {
  return null;
}
