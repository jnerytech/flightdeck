import type {
  PermissionMode,
  SessionEventOf,
  SessionRuntime,
  SessionSummary,
} from "@flightdeck/protocol";
import type { AutoApprover, RiskClassifier } from "../permissions/index.ts";
import type { AgentRuntime, QuotaReading } from "../runtime/index.ts";
import type { EventStore } from "../store/index.ts";

/** What the session manager is built with (#1595: out of the manager, which re-exports it). */
export interface SessionManagerOptions {
  store: EventStore;
  runtime: AgentRuntime;
  /** Phase 39: OpenCode sessions run here; none when the host has no OpenCode. */
  opencode?: AgentRuntime;
  allowedRoots: readonly string[];
  defaultPermissionMode: PermissionMode;
  allowApiKey: boolean;
  /** Whether a session may start in `bypassPermissions` (the host switch); refused when absent. */
  allowBypass?: () => boolean;
  /** Folders being removed (issue #152): no session starts in one. */
  folderLocks?: { isHeld(cwd: string): boolean };
  /** Whether a folder's own configuration may load in a session (issue #196); absent: it always does. */
  trust?: (cwd: string) => { trusted: boolean; configRoot?: string };
  /** Looks at a folder's git boundaries before its run is decided (issue #196); awaited by every async entry. */
  prepareTrust?: (cwd: string) => Promise<void>;
  baseEnv: Record<string, string | undefined>;
  /** Plan quota readings of any session go to the host's quota (phase 7). */
  onQuota?: (readings: QuotaReading[]) => void;
  /** Every turn of a managed session, before it is stored (phase 7's usage). */
  onTurn?: (
    sessionId: string,
    cwd: string,
    turn: SessionEventOf<"turn.result">,
    /** Phase 39: OpenCode turns spend no Claude plan, so the account is not told. */
    runtime: SessionRuntime,
  ) => void;
  /** How many sessions are running or waiting for a permission, after every change of status (keep-awake, #163). */
  onActivity?: (active: number) => void;
  /** Start and end of every turn (phase 12's snapshots); the first start waits for session.init. */
  onTurnEdge?: (edge: TurnEdge) => void;
  /** Phase 13: the risk of each permission request; built-in rules over allowedRoots when absent. */
  risk?: RiskClassifier;
  /** Issue #157: a session the host wants awake (pinned, a card's): it never sleeps. */
  keepAwake?: (session: SessionSummary) => boolean;
  /** Phase 13: the projects' automatic approval. */
  autoApprove?: Pick<AutoApprover, "decide">;
}

export interface TurnEdge {
  sessionId: string;
  claudeSessionId: string;
  cwd: string;
  kind: "before" | "after";
  prompt?: string;
  /** The user message's uuid (before edges), which the SDK rewinds to. */
  turnUuid?: string;
}
