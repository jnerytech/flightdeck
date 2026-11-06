/**
 * Issue #502: a Claude Code session that is live in another terminal (VS Code's, say). Opening it
 * again starts a second `claude` on the same session id: the two do not see each other's turns.
 */
import type { ExternalSession, ExternalStatus } from "@flightdeck/protocol";
import { sessionKey } from "./app-store.ts";

/** A `claude` that is still running there: in a turn, waiting for its next prompt or for an answer. */
const LIVE: ReadonlySet<ExternalStatus> = new Set(["running", "idle", "awaiting_permission"]);

/** The external session that is live right now under this id on this host, or null. */
export function liveElsewhere(
  externals: Record<string, ExternalSession>,
  hostId: string,
  claudeSessionId: string,
): ExternalSession | null {
  const session = externals[sessionKey(hostId, claudeSessionId)];
  return session && LIVE.has(session.status) ? session : null;
}
