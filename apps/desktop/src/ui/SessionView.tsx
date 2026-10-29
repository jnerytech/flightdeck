import type { PermissionUpdate } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { type T, translator } from "../i18n/index.ts";
import { usd } from "../lib/costs.ts";
import type { ChatItem, SessionState } from "../lib/session-state.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Markdown } from "./Markdown.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { ToolCall } from "./ToolCall.tsx";

const PT = translator("pt-BR");

export interface SessionActions {
  /** Copies a text (the approval's folder); the app's store does. */
  copyText?(text: string): Promise<boolean>;
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  resume(): Promise<void>;
  respond(
    requestId: string,
    decision: "allow" | "deny",
    message?: string,
    updatedPermissions?: PermissionUpdate[],
  ): Promise<void>;
}

function TimelineItem(props: {
  item: ChatItem;
  session: SessionState;
  actions: SessionActions;
  alwaysAllow: boolean;
  t: T;
  nowMs: number;
}) {
  const { item, session, actions } = props;
  switch (item.kind) {
    case "user":
      return <div className="msg msg-user">{item.text}</div>;
    case "assistant":
      return (
        <div className="msg msg-assistant">
          {item.blocks.map((block, i) =>
            block.type === "text" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are immutable and ordered
              <Markdown key={i} text={block.text} />
            ) : (
              <ToolCall
                key={block.id}
                name={block.name}
                input={block.input}
                result={session.toolResults[block.id]}
              />
            ),
          )}
        </div>
      );
    case "permission":
      return (
        <ApprovalCard
          request={{
            requestId: item.requestId,
            toolName: item.toolName,
            input: item.input,
            cwd: session.cwd ?? null,
            createdAt: item.at ?? null,
            ...(item.suggestions ? { suggestions: item.suggestions } : {}),
          }}
          t={props.t}
          nowMs={props.nowMs}
          {...(actions.copyText
            ? { onCopyPath: (path: string) => void actions.copyText?.(path) }
            : {})}
          alwaysAllow={props.alwaysAllow}
          {...(item.resolution ? { resolution: item.resolution } : {})}
          onRespond={(decision, message, updates) =>
            void actions.respond(item.requestId, decision, message, updates)
          }
        />
      );
    case "result": {
      const cost = item.costUsd !== undefined ? ` · US$ ${item.costUsd.toFixed(4)}` : "";
      return (
        <div className={item.isError ? "turn-result error" : "turn-result"}>
          {`${item.subtype} · ${(item.durationMs / 1000).toFixed(1)} s${cost}`}
        </div>
      );
    }
    case "error":
      return <div className="session-error">{`${item.code}: ${item.message}`}</div>;
  }
}

/** Chat history in streaming, tool calls, approval cards, message box and session controls. */
export function SessionView(props: {
  title: string;
  session: SessionState;
  actions: SessionActions;
  focusRequestId?: string | null;
  /** The host announces `rules` (phase 7): approvals offer "permitir sempre". */
  alwaysAllow?: boolean;
  /** "Abrir no terminal" (phase 8), when the view belongs to a session of its own. */
  terminal?: ReactNode;
  /** Estimated cost of the session and its subagents (phase 8); `null` when unknown. */
  costUsd?: number | null;
  /** The app's translator and clock (phase 10); pt-BR and the real clock when absent. */
  t?: T;
  nowMs?: number;
}) {
  const { focusRequestId } = props;
  const timeline = useRef<HTMLDivElement>(null);
  const cards = props.session.items.length;
  useEffect(() => {
    if (!focusRequestId || cards === 0) return;
    const card = timeline.current?.querySelector(`[data-request-id="${focusRequestId}"]`);
    card?.scrollIntoView?.({ block: "center" });
  }, [focusRequestId, cards]);
  const { session, actions } = props;
  const [text, setText] = useState("");
  const [closing, setClosing] = useState(false);
  const closed = session.status === "ended" || session.status === "error";

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    void actions.send(value);
  };

  return (
    <section className="session">
      <header className="session-header">
        <div>
          <h2>{props.title}</h2>
          <div className="muted">{session.cwd}</div>
          {typeof props.costUsd === "number" && (
            <div className="muted">
              custo estimado: <output aria-label="Custo da sessão">{usd(props.costUsd)}</output>
            </div>
          )}
        </div>
        <div className="session-controls">
          {session.status && <StatusBadge status={session.status} />}
          {session.statusReason && <span className="muted">{session.statusReason}</span>}
          {props.terminal}
          {closed ? (
            <button type="button" onClick={() => void actions.resume()}>
              Retomar
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void actions.interrupt()}>
                Interromper
              </button>
              <button type="button" onClick={() => setClosing(true)}>
                Encerrar
              </button>
              {closing && (
                <ConfirmDialog
                  message="Encerrar esta sessão? O Claude Code para; dá para retomá-la depois."
                  confirmLabel="Encerrar sessão"
                  destructive
                  onConfirm={() => {
                    setClosing(false);
                    void actions.close();
                  }}
                  onCancel={() => setClosing(false)}
                />
              )}
            </>
          )}
        </div>
      </header>
      <div className="timeline" ref={timeline}>
        {session.pruned && session.items.length === 0 && (
          <p className="muted">conversa removida pela retenção</p>
        )}
        {session.items.map((item) => (
          <TimelineItem
            key={item.seq}
            item={item}
            session={session}
            actions={actions}
            alwaysAllow={props.alwaysAllow === true}
            t={props.t ?? PT}
            nowMs={props.nowMs ?? Date.now()}
          />
        ))}
        {session.streaming && (
          <div className="msg msg-assistant streaming">{session.streaming}</div>
        )}
      </div>
      <div className="composer">
        <textarea
          aria-label="Mensagem"
          placeholder="Mensagem (Ctrl+Enter envia)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="primary" onClick={submit}>
          Enviar
        </button>
      </div>
    </section>
  );
}
