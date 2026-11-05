/**
 * Decision records, one file each (#304). `docs/DECISIONS.md` is frozen: GitHub ignores
 * `merge=union`, so every PR that appended to it went DIRTY next to any other. New entries are
 * files of their own under `docs/decisions/`, named `<yyyy-mm-dd>-<topic>.md`.
 */

/** The sha256 of docs/DECISIONS.md as frozen; a change to it means an entry went to the old file. */
export const FROZEN_DECISIONS_SHA256 = "";

/** Why a file under docs/decisions/ is not a decision record as named and titled, or null. */
export function decisionFileProblem(_name: string, _firstLine: string): string | null {
  return null;
}
