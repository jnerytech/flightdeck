import {
  type ExternalSession,
  type ExternalStatus,
  type PermissionMode,
  SessionPersona,
} from "@flightdeck/protocol";
import { parseJsonOr } from "../../kernel/index.ts";
import type { Waiting } from "./waiting.ts";

export type HookPayload = Record<string, unknown>;

export interface Row {
  claude_session_id: string;
  cwd: string | null;
  transcript_path: string | null;
  source: string | null;
  status: ExternalStatus;
  status_reason: string | null;
  launch_id: string | null;
  channel_connected: number;
  project_key: string | null;
  started_at: string;
  last_event_at: string;
  ended_at: string | null;
  persona_open: string | null;
  persona_applied: string | null;
  permission_mode: PermissionMode | null;
}

/** State after each hook event (docs/SPEC-fase-5.md); Notification depends on its type. */
const NEXT: Record<string, ExternalStatus> = {
  SessionStart: "idle",
  UserPromptSubmit: "running",
  PermissionRequest: "awaiting_permission",
  PostToolUse: "running",
  PostToolUseFailure: "running",
  PermissionDenied: "running",
  Stop: "idle",
  SessionEnd: "ended",
};

export function nextStatus(event: string, payload: HookPayload): ExternalStatus | null {
  if (event !== "Notification") return NEXT[event] ?? null;
  return payload.notification_type === "permission_prompt" ? "awaiting_permission" : null;
}

/** The first of the stored personas that fits, as the `persona` field of a session; none when none does. */
export const personaOf = (
  ...stored: Array<string | null | undefined>
): { persona?: SessionPersona } => {
  for (const text of stored) {
    const persona = text ? parseJsonOr(SessionPersona, text, null) : null;
    if (persona) return { persona };
  }
  return {};
};

export const toSession = (
  row: Row,
  waiting: Waiting | null,
  plan: string | null,
): ExternalSession => ({
  claudeSessionId: row.claude_session_id,
  cwd: row.cwd,
  transcriptPath: row.transcript_path,
  source: row.source,
  status: row.status,
  statusReason: row.status_reason,
  launchId: row.launch_id,
  controllable: row.channel_connected === 1,
  projectKey: row.project_key,
  startedAt: row.started_at,
  lastEventAt: row.last_event_at,
  endedAt: row.ended_at,
  // What was applied to the open session, else what it was opened with.
  ...personaOf(row.persona_applied, row.persona_open),
  ...(row.permission_mode ? { permissionMode: row.permission_mode } : {}),
  // A session that has ended or asks for a permission is not told apart by its transcript's end (#1736).
  ...(waiting && row.status !== "ended" && row.status !== "awaiting_permission"
    ? { waiting, ...(plan ? { waitingPlan: plan } : {}) }
    : {}),
});
