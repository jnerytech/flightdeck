import type { PendingPermission, SessionRuntime, SessionStatus } from "@flightdeck/protocol";

/** What the sidebar knows about a session, straight from `session.summary`. */
export interface SidebarSession {
  id: string;
  name: string | null;
  cwd: string;
  status: SessionStatus;
  pendingPermissions: PendingPermission[];
  updatedAt: string;
  /** Phase 39: set for an OpenCode session only. */
  runtime?: SessionRuntime;
  /** Issue #463: its folder's trust was revoked after the run loaded the project's setup. */
  trustStale?: boolean;
  /** Issue #1478: the host marked it quiet (a running session that says nothing), since when. */
  quietSince?: string;
  /** Issue #1478: the last tool it called before it went quiet. */
  quietTool?: string | null;
}
