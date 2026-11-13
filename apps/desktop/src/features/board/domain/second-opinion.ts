import type { ReviewComment } from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";

/**
 * The reviewer drafts still open on a card (#1446, the second-opinion review): the findings of the
 * review that nobody has sent, edited (which makes them the person's) or dismissed.
 */
export function openFindings(comments: readonly ReviewComment[]): { open: number; high: number } {
  const open = comments.filter((c) => c.state === "draft" && c.author === "reviewer");
  const high = open.filter((c) => c.severity === "blocker" || c.severity === "high");
  return { open: open.length, high: high.length };
}

/**
 * The Open PR confirm's line: "2 reviewer findings not addressed (1 high)". Only when a blocker or
 * a high finding is still open; the PR opens all the same.
 */
export function findingsNote(t: T, comments: readonly ReviewComment[]): string | null {
  const { open, high } = openFindings(comments);
  if (high === 0) return null;
  return open === 1
    ? t("secondOpinion.notAddressedOne", { high })
    : t("secondOpinion.notAddressed", { n: open, high });
}
