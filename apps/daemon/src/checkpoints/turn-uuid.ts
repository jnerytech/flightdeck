/**
 * Phase 12: a terminal session's snapshot knows the prompt of its turn (the hook says it) but not
 * the uuid of the user message in the transcript, which "Bifurcar daqui" needs. The uuid is found
 * by matching the prompt with the user messages the history index read, on demand.
 */
import { MAX_TEXT_BYTES, truncateUtf8 } from "../history/parser.ts";
import type { SnapshotRow } from "./snapshots.ts";

export interface UserPrompt {
  uuid: string;
  text: string;
}

/** The index keeps a message cut to this size, so a prompt is compared as it was cut. */
const key = (text: string) => truncateUtf8(text, MAX_TEXT_BYTES).trim();

/**
 * Gives the `before` snapshots that have a prompt and no uuid the uuid of the user message with
 * the same text. The same prompt said several times matches in the order it was said, but only when
 * there are as many turns as messages: otherwise a turn may belong to any of them and none is
 * chosen. Rows that already have a uuid (managed sessions) and all other rows stay as they are.
 */
export function withTurnUuids(rows: SnapshotRow[], prompts: UserPrompt[]): SnapshotRow[] {
  const turns = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    if (row.kind !== "before" || row.turnUuid !== null || row.prompt === null) continue;
    turns.set(key(row.prompt), [...(turns.get(key(row.prompt)) ?? []), row]);
  }
  const found = new Map<number, string>();
  for (const [text, group] of turns) {
    const said = prompts.filter((p) => key(p.text) === text);
    if (said.length !== group.length) continue;
    for (const [i, row] of group.entries()) found.set(row.n, (said[i] as UserPrompt).uuid);
  }
  return rows.map((row) =>
    found.has(row.n) ? { ...row, turnUuid: found.get(row.n) ?? null } : row,
  );
}
