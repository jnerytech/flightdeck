import { clampPermissionMode, type PermissionMode } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";

/** The session manager's refusals: the codes and the words one session call can fail with. */

export function sessionNotFound(sessionId: string): FlightdeckError {
  return new FlightdeckError(
    "not_found",
    `session ${sessionId} does not exist`,
    "session_not_found",
    { id: sessionId },
  );
}

export function personasUnavailable(): FlightdeckError {
  return new FlightdeckError("invalid_state", "personas unavailable on this host", "personas_off");
}

export function bypassNotAllowed(): FlightdeckError {
  return new FlightdeckError(
    "invalid_permission_update",
    "this host does not allow sessions without permission prompts",
    "bypass_not_allowed",
  );
}

/** A message to a session that is over. */
export function sessionEnded(status: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `session is ${status}; use session.resume`,
    "session_ended",
  );
}

/** A resume of a session that is not over. */
export function sessionNotEnded(status: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `session is ${status}; nothing to resume`,
    "session_not_ended",
  );
}

/** A Claude-only feature asked of an OpenCode session. */
export function runtimeUnsupported(feature: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `an OpenCode session does not offer ${feature}`,
    "runtime_unsupported",
    { feature },
  );
}

/** What a live session is asked to change or report, and the code each refusal carries. */
const NOT_LIVE = {
  mode: { words: "change its permission mode", reason: "mode_set_not_live" },
  model: { words: "change its model", reason: "model_set_not_live" },
  effort: { words: "change its effort", reason: "effort_set_not_live" },
  mcpSet: { words: "change its MCP servers", reason: "mcp_set_not_live" },
  mcpQuery: { words: "query its MCP servers", reason: "mcp_query_not_live" },
} as const;

/** A live setting asked of a session that has no running process, or whose runtime has no such call. */
export function sessionNotLive(what: keyof typeof NOT_LIVE): FlightdeckError {
  const { words, reason } = NOT_LIVE[what];
  return new FlightdeckError("invalid_state", `the session is not alive to ${words}`, reason);
}

/**
 * Never looser than the mode the session started with (which a persona may have narrowed),
 * unless the person turned the host's switch on: then any mode is theirs to pick.
 */
export function refuseLooserMode(
  mode: PermissionMode,
  startMode: () => PermissionMode,
  bypassAllowed: boolean,
): void {
  if (bypassAllowed || clampPermissionMode(mode, startMode()) === mode) return;
  throw new FlightdeckError(
    "invalid_permission_update",
    "a session cannot be made more permissive than the mode it started with",
    "mode_looser_than_start",
  );
}
