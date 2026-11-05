/**
 * Decision records, one file each (#304). `docs/DECISIONS.md` is frozen: GitHub ignores
 * `merge=union`, so every PR that appended to it went DIRTY next to any other. New entries are
 * files of their own under `docs/decisions/`, named `<yyyy-mm-dd>-<topic>.md`.
 */

/** The sha256 of docs/DECISIONS.md as frozen; a change to it means an entry went to the old file. */
export const FROZEN_DECISIONS_SHA256 =
  "e72747a345621196f8d9a4d5b0e31f6a99b55b22d274b5522502e633969fe835";

/** Why a file under docs/decisions/ is not a decision record as named and titled, or null. */
export function decisionFileProblem(name: string, firstLine: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)) {
    return `${name}: name it <yyyy-mm-dd>-<topic>.md (lowercase words joined by hyphens)`;
  }
  if (!/^# .+ \((?:issue #\d+|phase \d+)\)$/.test(firstLine)) {
    return `${name}: give it a first line \`# <title> (issue #N)\` or \`(phase N)\``;
  }
  return null;
}
