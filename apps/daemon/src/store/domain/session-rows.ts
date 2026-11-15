import {
  type PermissionMode,
  SessionPersona,
  type SessionRuntime,
  type SessionStatus,
  type SessionSummary,
  ToolInput,
} from "@flightdeck/protocol";
import { parseJsonOr, parseJsonWith } from "../../kernel/index.ts";
import { PersonaSnapshotJson } from "./row-json.ts";

export type PermissionStatus = "pending" | "allowed" | "denied" | "cancelled" | "expired";

export interface PermissionRecord {
  id: string;
  sessionId: string;
  toolName: string;
  input: ToolInput;
  status: PermissionStatus;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SessionRow {
  id: string;
  claude_session_id: string | null;
  name: string | null;
  cwd: string;
  status: SessionStatus;
  permission_mode: PermissionMode;
  model: string | null;
  runtime: SessionRuntime;
  persona: string | null;
  applied_persona: string | null;
  last_seq: number;
  created_at: string;
  updated_at: string;
}

export interface PermissionRow {
  id: string;
  session_id: string;
  tool_name: string;
  input: string;
  status: PermissionStatus;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** What was applied to the open session, else what it was opened with. */
function personaOf(row: SessionRow): { persona?: SessionPersona } {
  const applied = row.applied_persona && parseJsonOr(SessionPersona, row.applied_persona, null);
  if (applied) return { persona: applied };
  const opened = row.persona && parseJsonOr(PersonaSnapshotJson, row.persona, null);
  return opened ? { persona: personaBadge(opened) } : {};
}

export function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    status: row.status,
    permissionMode: row.permission_mode,
    model: row.model,
    claudeSessionId: row.claude_session_id,
    runtime: row.runtime,
    lastSeq: row.last_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...personaOf(row),
  };
}

/** The part of a persona the lists and the timeline show. */
export function personaBadge(snapshot: SessionPersona): SessionPersona {
  return { id: snapshot.id, name: snapshot.name, icon: snapshot.icon };
}

export function toPermission(row: PermissionRow): PermissionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    input: parseJsonWith(ToolInput, row.input),
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}
