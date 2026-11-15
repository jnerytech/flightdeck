/**
 * Issue #77: what the person's answer to a held round (push it, or drop its commits) decides,
 * apart from the git and the rows it acts on.
 */
import { COMMIT_ID } from "./fix-round.ts";

export type HeldAction = "push" | "drop";

/**
 * Whether the branch is no longer where the round was held: the held commit id is unknown (or, for
 * a drop, the round's start is), or HEAD is another commit. A drop needs the start; a push does not.
 */
export function heldMoved(action: HeldAction, held: { sha: string; base: string }, head: string) {
  const known = COMMIT_ID.test(held.sha) && (action === "push" || COMMIT_ID.test(held.base));
  return !known || head !== held.sha;
}

/** The status a resolved round ends with, and the line that says what the person did. */
export function resolvedRound(action: HeldAction, summary: string | null) {
  return action === "push"
    ? { status: "pushed", summary: `pushed by you after the hold: ${summary ?? ""}` }
    : {
        status: "stopped",
        summary: "dropped by you: the branch is back where the round started",
      };
}
