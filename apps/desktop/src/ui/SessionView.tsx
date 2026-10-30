import type { PermissionUpdate } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import {
  Composer,
  Message,
  SessionHeader,
  SessionPane,
  Timeline,
} from "@/components/session/parts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { T } from "../i18n/index.ts";
import { usd } from "../lib/costs.ts";
import type { ChatItem, SessionState } from "../lib/session-state.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Markdown } from "./Markdown.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { ToolCall } from "./ToolCall.tsx";

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
      return <Message from="user">{item.text}</Message>;
    case "assistant":
      return (
        <Message from="assistant">
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
        </Message>
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
        <div
          className={cn(
            "text-muted-foreground text-xs tabular-nums",
            item.isError && "text-status-error",
          )}
        >
          {props.t(item.isError ? "session.turnFailed" : "session.turnDone", {
            seconds: (item.durationMs / 1000).toFixed(1),
          }) + cost}
        </div>
      );
    }
    case "error":
      return (
        <div className="rounded-md border border-status-error/40 p-3 text-sm text-status-error">{`${item.code}: ${item.message}`}</div>
      );
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
  /** "Linha do tempo" (phase 12), when the host has checkpoints. */
  timeline?: ReactNode;
  /** Estimated cost of the session and its subagents (phase 8); `null` when unknown. */
  costUsd?: number | null;
  /** The app's translator and clock (phase 10); pt-BR and the real clock when absent. */
  t?: T;
  nowMs?: number;
}) {
  const ctx = useT();
  const t = props.t ?? ctx;
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
    <SessionPane>
      <SessionHeader
        title={props.title}
        subtitle={
          <>
            <span>{session.cwd}</span>
            {typeof props.costUsd === "number" && (
              <span>
                {t("session.cost")}{" "}
                <output aria-label={t("session.costLabel")}>{usd(props.costUsd)}</output>
              </span>
            )}
          </>
        }
        controls={
          <>
            {session.status && <StatusBadge status={session.status} />}
            {session.statusReason && (
              <span className="text-muted-foreground text-xs">{session.statusReason}</span>
            )}
            {props.timeline}
            {props.terminal}
            {closed ? (
              <Button variant="outline" size="sm" onClick={() => void actions.resume()}>
                {t("session.resume")}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => void actions.interrupt()}>
                  {t("session.interrupt")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setClosing(true)}>
                  {t("session.end")}
                </Button>
                {closing && (
                  <ConfirmDialog
                    message={t("session.endMessage")}
                    confirmLabel={t("session.endConfirm")}
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
          </>
        }
      />
      <Timeline ref={timeline}>
        {session.pruned && session.items.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("session.pruned")}</p>
        )}
        {session.items.map((item) => (
          <TimelineItem
            key={item.seq}
            item={item}
            session={session}
            actions={actions}
            alwaysAllow={props.alwaysAllow === true}
            t={t}
            nowMs={props.nowMs ?? Date.now()}
          />
        ))}
        {session.streaming && (
          <Message from="assistant" className="opacity-80">
            {session.streaming}
          </Message>
        )}
      </Timeline>
      <Composer>
        <Textarea
          aria-label={t("session.message")}
          placeholder={t("session.placeholder")}
          value={text}
          className="max-h-40 min-h-9 flex-1 resize-none"
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button onClick={submit}>{t("session.send")}</Button>
      </Composer>
    </SessionPane>
  );
}
