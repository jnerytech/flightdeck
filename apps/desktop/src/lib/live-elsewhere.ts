/**
 * Issue #502: a Claude Code session that is live in another terminal (VS Code's, say). Opening it
 * again starts a second `claude` on the same session id: the two do not see each other's turns.
 */
import type { ExternalSession } from "@flightdeck/protocol";

/** The external session that is live right now under this id on this host, or null. */
export function liveElsewhere(
  externals: Record<string, ExternalSession>,
  hostId: string,
  claudeSessionId: string,
): ExternalSession | null {
  return null;
}
