/**
 * Issue #3425: the open permission requests as `flightdeckd requests` shows them. The daemon lists
 * them inside each session's summary (oldest first); this puts them in one list across sessions.
 */
import type { PendingPermission, SessionEventOf } from "@flightdeck/protocol";

export interface RequestRow {
  id: string;
  sessionId: string;
  session: string | null;
  tool: string;
  risk: PendingPermission["risk"] | null;
  riskReason: string | null;
  createdAt: string;
  input: Record<string, unknown> | null;
}

export function requestRows(
  _summaries: ReadonlyArray<SessionEventOf<"session.summary">>,
  _sessionId?: string,
): RequestRow[] {
  return [];
}

export function requestLine(_row: RequestRow): string {
  return "";
}
