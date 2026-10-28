import { useEffect, useRef, useState } from "react";
import type { ChatItem, SessionState } from "../lib/session-state.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { Markdown } from "./Markdown.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { ToolCall } from "./ToolCall.tsx";

export interface SessionActions {
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  resume(): Promise<void>;
  respond(requestId: string, decision: "allow" | "deny", message?: string): Promise<void>;
}

function TimelineItem(props: { item: ChatItem; session: SessionState; actions: SessionActions }) {
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
      return <ApprovalCard item={item} onRespond={(...args) => void actions.respond(...args)} />;
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
        </div>
        <div className="session-controls">
          {session.status && <StatusBadge status={session.status} />}
          {session.statusReason && <span className="muted">{session.statusReason}</span>}
          {closed ? (
            <button type="button" onClick={() => void actions.resume()}>
              Retomar
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void actions.interrupt()}>
                Interromper
              </button>
              <button type="button" onClick={() => void actions.close()}>
                Encerrar
              </button>
            </>
          )}
        </div>
      </header>
      <div className="timeline" ref={timeline}>
        {session.items.map((item) => (
          <TimelineItem key={item.seq} item={item} session={session} actions={actions} />
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
