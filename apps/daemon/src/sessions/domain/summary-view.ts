import type {
  PendingPermission,
  PlainInfo,
  SessionEvent,
  SessionSummary,
  ToolInput,
} from "@flightdeck/protocol";
import { type Risk, summarizeInput } from "../../permissions/index.ts";
import type { QuietInfo } from "./stall.ts";

/** A session with the silence the stall watcher marked on it, if any. */
export function withQuiet(session: SessionSummary, quiet: QuietInfo | undefined): SessionSummary {
  return quiet ? { ...session, quietSince: quiet.since, quietTool: quiet.tool } : session;
}

/** Idle with no process is asleep: the daemon put it to sleep, or a restart left it so. */
export function withSleep(session: SessionSummary, isLive: boolean): SessionSummary {
  return { ...session, asleep: session.status === "idle" && !isLive };
}

/** One open permission request as a summary lists it. */
export function pendingView(
  request: { id: string; toolName: string; createdAt: string; input: ToolInput },
  risk: Risk,
  plain: PlainInfo | undefined,
): PendingPermission {
  return {
    requestId: request.id,
    toolName: request.toolName,
    createdAt: request.createdAt,
    input: summarizeInput(request.input),
    risk: risk.level,
    riskReason: risk.reason,
    ...(plain ? { plain } : {}),
  };
}

/** The `session.summary` event of a session: what a list needs without the transcript. */
export function summaryEvent(
  session: SessionSummary,
  pendingPermissions: PendingPermission[],
  flags: { stale: boolean; quiet: QuietInfo | undefined },
): SessionEvent {
  return {
    type: "session.summary",
    sessionId: session.id,
    name: session.name,
    cwd: session.cwd,
    status: session.status,
    pendingPermissions,
    updatedAt: session.updatedAt,
    ...(session.runtime === "opencode" ? { runtime: "opencode" as const } : {}),
    ...(flags.stale ? { trustStale: true as const } : {}),
    ...(flags.quiet ? { quietSince: flags.quiet.since, quietTool: flags.quiet.tool } : {}),
  };
}
