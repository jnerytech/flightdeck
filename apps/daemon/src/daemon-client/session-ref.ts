/**
 * Issue #3425: a session as a terminal names it. The commands that act on one session take its id or
 * its name; an id wins, and a name that two sessions share is refused with the list, never guessed.
 */
import { type CliResult, failure } from "./cli-view.ts";

export type SessionRef = { id: string } | { refusal: CliResult };

export function resolveSession(
  sessions: ReadonlyArray<{ id: string; name: string | null }>,
  ref: string,
): SessionRef {
  const byId = sessions.find((s) => s.id === ref);
  if (byId) return { id: byId.id };
  const named = sessions.filter((s) => s.name === ref);
  const [only] = named;
  if (only && named.length === 1) return { id: only.id };
  if (!only) return { refusal: failure(1, `no such session: ${ref}`) };
  const ids = named.map((s) => s.id).join(", ");
  return { refusal: failure(1, `${named.length} sessions are named ${ref}: use an id (${ids})`) };
}
