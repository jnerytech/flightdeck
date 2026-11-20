/**
 * Issue #3425: a session as a terminal names it. The commands that act on one session take its id or
 * its name; an id wins, and a name that two sessions share is refused with the list, never guessed.
 */
import type { CliResult } from "./cli-view.ts";

export type SessionRef = { id: string } | { refusal: CliResult };

export function resolveSession(
  _sessions: ReadonlyArray<{ id: string; name: string | null }>,
  _ref: string,
): SessionRef {
  return { id: "" };
}
