/**
 * Issue #3537: a destination as a terminal names it. The commands that act on one take its id or its
 * name; an id wins, and a name that two destinations share is refused with their ids, never guessed.
 */
import type { SshTarget } from "@flightdeck/protocol";

export type SshTargetRef = { target: SshTarget } | { problem: string };

export function resolveSshTarget(targets: readonly SshTarget[], ref: string): SshTargetRef {
  const byId = targets.find((t) => t.id === ref);
  if (byId) return { target: byId };
  const named = targets.filter((t) => t.name === ref);
  const [only] = named;
  if (!only) return { problem: `no such ssh target: ${ref}` };
  if (named.length === 1) return { target: only };
  const ids = named.map((t) => t.id).join(", ");
  return { problem: `${named.length} ssh targets are named ${ref}: use an id (${ids})` };
}
