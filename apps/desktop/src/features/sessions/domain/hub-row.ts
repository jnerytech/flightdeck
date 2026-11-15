import type { SessionLine, SessionPersona } from "@flightdeck/protocol";

export type HubOrigin = "flightdeck" | "terminal" | "history" | "background";
export type HubState = "running" | "needs_you" | "idle" | "ended" | "failed";

/** One line of the Sessões screen, whatever the session's origin. */
export interface HubRow {
  key: string;
  hostId: string;
  hostName: string;
  origin: HubOrigin;
  claudeSessionId: string | null;
  /** Managed sessions only: the daemon's session id. */
  sessionId: string | null;
  title: string;
  cwd: string;
  projectKey: string;
  state: HubState;
  controllable: boolean;
  lastActivity: string;
  pinned: boolean;
  archived: boolean;
  /** What the daemon says about it (phase 8); absent on older daemons. */
  summary: SessionLine | null;
  /** The persona it runs in (phase 20). */
  persona: SessionPersona | null;
  /** Phase 21: `project · persona · number`, on a host with names; null elsewhere. */
  standardName?: string | null;
  /** Issue #157: idle with no process: a message wakes it. Only a managed session can be. */
  asleep?: boolean;
  /** Phase 39: set for an OpenCode session only. */
  runtime?: "opencode";
  /** Issue #1478: the host marked this running session quiet, since when; and its last tool. */
  quietSince?: string;
  quietTool?: string | null;
  /** Issue #1736: a terminal session waits at a plan approval or a question (read by the daemon). */
  waiting?: "plan" | "question";
  /** Issue #1751: the plan a `plan` wait asks approval of (the daemon cut it). */
  waitingPlan?: string;
}

export interface HubFilter {
  text: string;
  origin: "" | HubOrigin;
  state: "" | HubState;
  /** A persona id, or "" for all (phase 20). */
  persona: string;
  pinnedOnly: boolean;
  showArchived: boolean;
}

export interface HubGroup {
  key: string;
  /**
   * What the fold state is kept under. Unlike `key` it does not depend on which rows are there:
   * a host going offline or two folders merging leave it as it was.
   */
  foldKey: string;
  /** Repository name (or folder) shown on the group. */
  name: string;
  /** Where the project is, when another group has the same name; else absent. */
  hint?: string;
  rows: HubRow[];
}
