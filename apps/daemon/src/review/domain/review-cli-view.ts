/**
 * Issue #3619: what `flightdeckd review` prints, as pure rules over the daemon's answers. A `--json` value
 * keeps every key: `null` where the daemon sends none (`author` and `severity` of a person's comment).
 */
import type { ReviewComment, ReviewSent } from "@flightdeck/protocol";

/** The comment as the protocol returns it, with every field it leaves out as `null`. */
export const commentJson = (comment: ReviewComment) => ({
  ...comment,
  author: comment.author ?? null,
  severity: comment.severity ?? null,
});

const lines = (c: ReviewComment): string =>
  c.lineStart === c.lineEnd ? `${c.lineStart}` : `${c.lineStart}-${c.lineEnd}`;

/** What names a comment: its id, then the file and lines it is on and the side of the diff. */
export const commentHead = (c: ReviewComment): string => `${c.id}  ${c.path}:${lines(c)} ${c.side}`;

/** What a send reports: how many comments went, and where; a `copy` means nobody took the review. */
export function sentLines(sent: ReviewSent): string[] {
  const count = `${sent.comments} ${sent.comments === 1 ? "comment" : "comments"}`;
  if (sent.via === "copy")
    return [
      `sent ${count}, but nobody takes it: copy the review below`,
      ...sent.text.split(/\r\n|\r|\n/),
    ];
  return [`sent ${count} to the ${sent.via}`];
}

/** One line a comment (id, file and lines, side, then its state, `outdated` and a second opinion's author and severity), its body under it. */
function commentBlock(c: ReviewComment): string[] {
  const finding = [c.author, c.severity].filter((part) => part !== undefined).join(" ");
  const flags = [c.state, ...(c.outdated ? ["outdated"] : []), ...(finding ? [finding] : [])];
  return [
    `${commentHead(c)}  ${flags.join(", ")}`,
    ...c.body.split(/\r\n|\r|\n/).map((line) => `  ${line}`),
  ];
}

/** The comments in the order the daemon gives; a target with none says so. */
export const commentLines = (target: string, comments: ReviewComment[]): string[] =>
  comments.length === 0 ? [`${target}: no comments`] : comments.flatMap(commentBlock);
