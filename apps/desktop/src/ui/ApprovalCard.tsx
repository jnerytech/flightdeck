import type { PermissionUpdate } from "@flightdeck/protocol";
import { useState } from "react";
import { toolDiff } from "../lib/diff.ts";
import type { ChatItem } from "../lib/session-state.ts";
import { AlwaysAllow } from "./AlwaysAllow.tsx";

type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

const RESOLUTION_LABELS = {
  allow: "permitido",
  deny: "negado",
  cancelled: "cancelado",
  expired: "expirado",
} as const;

/** Inline approval card: tool, formatted input (or diff for edits), allow / deny with reason. */
export function ApprovalCard(props: {
  item: PermissionItem;
  /** The host announces `rules`: "permitir nesta sessão" and "sempre neste projeto". */
  alwaysAllow: boolean;
  onRespond(
    requestId: string,
    decision: "allow" | "deny",
    message?: string,
    updatedPermissions?: PermissionUpdate[],
  ): void;
}) {
  const { item } = props;
  const [reason, setReason] = useState("");
  const diff = toolDiff(item.toolName, item.input);
  const resolution = item.resolution;

  return (
    <div
      className={`approval ${resolution ? "resolved" : "open"}`}
      data-request-id={item.requestId}
    >
      <div className="approval-title">
        Permissão para <strong>{item.toolName}</strong>
      </div>
      {diff ? (
        <pre className="diff">
          {diff.map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and immutable
              key={i}
              className={`diff-line diff-${line.op === "+" ? "add" : line.op === "-" ? "del" : "ctx"}`}
            >
              {`${line.op} ${line.text}`}
            </div>
          ))}
        </pre>
      ) : (
        <pre className="tool-input">{JSON.stringify(item.input, null, 2)}</pre>
      )}
      {resolution ? (
        <div className="approval-result">
          {resolution.message && resolution.decision === "deny"
            ? `negado: ${resolution.message}`
            : RESOLUTION_LABELS[resolution.decision]}
        </div>
      ) : (
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            onClick={() => props.onRespond(item.requestId, "allow")}
          >
            Permitir
          </button>
          <input
            aria-label="Motivo (opcional)"
            placeholder="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="danger"
            onClick={() => props.onRespond(item.requestId, "deny", reason.trim() || undefined)}
          >
            Negar
          </button>
          {props.alwaysAllow && (
            <AlwaysAllow
              toolName={item.toolName}
              input={item.input}
              suggestions={item.suggestions}
              onAllow={(updates) => props.onRespond(item.requestId, "allow", undefined, updates)}
            />
          )}
        </div>
      )}
    </div>
  );
}
