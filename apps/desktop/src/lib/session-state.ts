import type {
  AssistantBlock,
  AutoApproval,
  EventEnvelope,
  PermissionResolution,
  PermissionUpdate,
  RiskLevel,
  SessionPersona,
  SessionStatus,
  ToolInput,
} from "@flightdeck/protocol";

export type ChatItem =
  /** Part of the history is missing: a hole in the seqs the host could not fill. */
  | { kind: "gap"; seq: number }
  | { kind: "user"; seq: number; text: string }
  | { kind: "assistant"; seq: number; blocks: AssistantBlock[] }
  | {
      kind: "permission";
      seq: number;
      requestId: string;
      toolName: string;
      input: ToolInput;
      /** What the CLI offers to stop asking (phase 7). */
      suggestions?: PermissionUpdate[];
      resolution?: { decision: PermissionResolution; message?: string; auto?: AutoApproval };
      /** Phase 13: the risk the daemon judged, and why. */
      risk?: RiskLevel;
      riskReason?: string;
      /** When it was asked (the event's time): the card shows its age (phase 10). */
      at?: string;
    }
  | {
      kind: "result";
      seq: number;
      subtype: string;
      isError: boolean;
      durationMs: number;
      costUsd?: number;
    }
  | { kind: "error"; seq: number; code: string; message: string }
  /** A persona applied to the session or left (phase 20). */
  | { kind: "persona"; seq: number; applied: boolean; name: string };

export interface SessionState {
  /** Last persisted seq applied; used for `sinceSeq` on reconnect. */
  lastSeq: number;
  status?: SessionStatus;
  statusReason?: string;
  cwd?: string;
  model?: string;
  /** The persona the session runs in (phase 20), from how it opened and from what was applied since. */
  persona?: SessionPersona;
  /** Claude Code's id, from `session.init`: "Abrir no terminal" resumes it. */
  claudeSessionId?: string;
  items: ChatItem[];
  /** Text of the turn being streamed (live `message.delta`, never replayed). */
  streaming: string;
  toolResults: Record<string, { content: string; isError: boolean }>;
  /** Open permission request ids. */
  pending: string[];
  /** The host's retention removed the events of this (ended) session. */
  pruned?: boolean;
}

export const emptySession = (): SessionState => ({
  lastSeq: 0,
  items: [],
  streaming: "",
  toolResults: {},
  pending: [],
});

export const endStreaming = (state: SessionState): SessionState => ({ ...state, streaming: "" });

/**
 * Applies one envelope. Persisted events at or below `lastSeq` are duplicates and ignored;
 * ephemeral deltas carry the last persisted seq and only feed the streaming buffer.
 */
export function applyEnvelope(state: SessionState, envelope: EventEnvelope): SessionState {
  const { event, seq } = envelope;
  // The only ephemeral event: live text, never deduplicated nor counted in lastSeq.
  if (event.type === "message.delta") return { ...state, streaming: state.streaming + event.text };
  if (seq <= state.lastSeq) return state;
  const next: SessionState = { ...state, lastSeq: seq };
  const push = (item: ChatItem) => ({ ...next, items: [...state.items, item] });

  switch (event.type) {
    // Host-wide summaries feed the sidebar, not the session timeline.
    case "session.summary":
      return state;
    case "session.created":
      return { ...next, cwd: event.cwd, ...(event.persona ? { persona: event.persona } : {}) };
    case "session.status":
      return { ...next, status: event.status, statusReason: event.reason };
    case "session.init":
      return { ...next, model: event.model, claudeSessionId: event.claudeSessionId };
    case "message.user":
      return push({ kind: "user", seq, text: event.text });
    case "message.assistant":
      return { ...push({ kind: "assistant", seq, blocks: event.blocks }), streaming: "" };
    case "tool.result":
      return {
        ...next,
        toolResults: {
          ...state.toolResults,
          [event.toolUseId]: { content: event.content, isError: event.isError },
        },
      };
    case "permission.requested":
      return {
        ...push({
          kind: "permission",
          seq,
          requestId: event.requestId,
          toolName: event.toolName,
          input: event.input,
          ...(event.suggestions ? { suggestions: event.suggestions } : {}),
          ...(event.risk ? { risk: event.risk } : {}),
          ...(event.riskReason ? { riskReason: event.riskReason } : {}),
          at: envelope.ts,
        }),
        pending: [...state.pending, event.requestId],
      };
    case "permission.resolved":
      return {
        ...next,
        pending: state.pending.filter((id) => id !== event.requestId),
        items: state.items.map((item) =>
          item.kind === "permission" && item.requestId === event.requestId
            ? {
                ...item,
                resolution: {
                  decision: event.decision,
                  ...(event.message ? { message: event.message } : {}),
                  ...(event.auto ? { auto: event.auto } : {}),
                },
              }
            : item,
        ),
      };
    case "turn.result":
      return {
        ...push({
          kind: "result",
          seq,
          subtype: event.subtype,
          isError: event.isError,
          durationMs: event.durationMs,
          ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        }),
        streaming: "",
      };
    // Applying or leaving a persona is marked on the timeline, next to the role message.
    case "persona.applied":
    case "persona.cleared": {
      const { persona: _left, ...rest } = push({
        kind: "persona",
        seq,
        applied: event.type === "persona.applied",
        name: event.persona.name,
      });
      // The session is in the persona just applied, or in none after one was left.
      return event.type === "persona.applied" ? { ...rest, persona: event.persona } : rest;
    }
    default:
      return push({ kind: "error", seq, code: event.code, message: event.message });
  }
}
