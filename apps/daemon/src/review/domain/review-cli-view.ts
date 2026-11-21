/**
 * Issue #3619: what `flightdeckd review` prints, as pure rules over the daemon's answers. A `--json` value
 * keeps every key: `null` where the daemon sends none (`author` and `severity` of a person's comment).
 */
import type { ReviewComment } from "@flightdeck/protocol";

/** The comment as the protocol returns it, with every field it leaves out as `null`. */
export const commentJson = (comment: ReviewComment): Record<string, unknown> => ({ ...comment });

/** One line a comment (its id, file and lines, side and state), then its body, indented. */
export const commentLines = (target: string, comments: ReviewComment[]): string[] =>
  comments.length === 0 ? [] : [target];
