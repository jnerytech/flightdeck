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
  summaries: ReadonlyArray<SessionEventOf<"session.summary">>,
  sessionId?: string,
): RequestRow[] {
  const rows = summaries
    .filter((s) => sessionId === undefined || s.sessionId === sessionId)
    .flatMap((s) =>
      s.pendingPermissions.map((p) => ({
        id: p.requestId,
        sessionId: s.sessionId,
        session: s.name,
        tool: p.toolName,
        risk: p.risk ?? null,
        riskReason: p.riskReason ?? null,
        createdAt: p.createdAt,
        input: p.input ?? null,
      })),
    );
  // The queue of the whole host, as the person would answer it: the one that waited longest first.
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** What the request asks is cut here: the line says which request it is, the app shows the rest. */
const ASKS_MAX = 120;

export function requestLine(row: RequestRow): string {
  const asks = row.input ? JSON.stringify(row.input) : "";
  const shown = asks.length > ASKS_MAX ? `${asks.slice(0, ASKS_MAX)}…` : asks;
  return [row.id, row.session ?? row.sessionId, row.risk ?? "unknown", row.tool, shown]
    .join("  ")
    .trimEnd();
}
