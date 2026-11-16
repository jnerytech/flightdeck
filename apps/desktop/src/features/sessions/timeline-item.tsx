import { memo } from "react";
import { ApprovalCard } from "@/features/permissions/ui.ts";
import { cn } from "@/lib/utils";
import { Markdown } from "@/shared/markdown/index.ts";
import type { Key, T } from "../../i18n/index.ts";
import { usd } from "../costs/index.ts";
import type { ChatItem, SessionState } from "./domain/session-state.ts";
import { errorText } from "./domain/session-text.ts";
import { MessageActions } from "./message-actions";
import { Message } from "./parts";
import type { SessionActions } from "./session-actions.ts";
import { ToolCall } from "./tool-call.tsx";

type Item<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;

function AssistantMessage(
  props: Readonly<{
    item: Item<"assistant">;
    toolResults: SessionState["toolResults"];
    t: T;
    actions: SessionActions;
    pin: { pinned: boolean; toggle(): void } | undefined;
    /** Only the latest message offers Fork. */
    fork: (() => void) | undefined;
  }>,
) {
  const text = props.item.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n");
  return (
    <Message from="assistant">
      {props.item.blocks.map((block, i) =>
        block.type === "text" ? (
          <Markdown
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks are immutable and ordered
            key={i} // NOSONAR: blocks are immutable and ordered
            text={block.text}
          />
        ) : (
          <ToolCall
            key={block.id}
            name={block.name}
            input={block.input}
            result={props.toolResults[block.id]}
          />
        ),
      )}
      {text !== "" && (
        <MessageActions
          text={text}
          at={props.item.at}
          t={props.t}
          copyText={props.actions.copyText}
          fork={props.fork}
          pin={props.pin}
        />
      )}
    </Message>
  );
}

function PermissionItem(
  props: Readonly<{
    item: Item<"permission">;
    cwd: string | null;
    actions: SessionActions;
    alwaysAllow: boolean;
    t: T;
    nowMs: number;
  }>,
) {
  const { item, actions } = props;
  return (
    <ApprovalCard
      request={{
        requestId: item.requestId,
        toolName: item.toolName,
        input: item.input,
        cwd: props.cwd,
        createdAt: item.at ?? null,
        ...(item.suggestions ? { suggestions: item.suggestions } : {}),
        ...(item.risk ? { risk: item.risk } : {}),
        ...(item.riskReason ? { riskReason: item.riskReason } : {}),
      }}
      t={props.t}
      nowMs={props.nowMs}
      {...(actions.copyText ? { onCopyPath: (path: string) => void actions.copyText?.(path) } : {})}
      alwaysAllow={props.alwaysAllow}
      {...(item.resolution ? { resolution: item.resolution } : {})}
      onRespond={(decision, message, updates, updatedInput, held) =>
        actions.respond(item.requestId, decision, {
          message,
          updatedPermissions: updates,
          updatedInput,
          held,
        })
      }
    />
  );
}

/** The failed-turn subtypes the CLI reports that have a sentence of their own. */
const TURN_REASONS = ["error_max_turns", "error_during_execution", "error_max_budget_usd"];

function TurnResult(props: Readonly<{ item: Item<"result">; t: T }>) {
  const { item } = props;
  // The turn's own cost; a turn that cost nothing says nothing (the total repeats it, #3408).
  const spent = item.turnCostUsd ?? item.costUsd;
  const cost = spent ? ` · ${usd(spent, props.t.lang, 4)}` : "";
  const seconds = (item.durationMs / 1000).toFixed(1);
  const known = TURN_REASONS.includes(item.subtype);
  let line = props.t("session.turnDone", { seconds });
  if (item.isError) {
    const reason = props.t(`session.turnReason.${known ? item.subtype : "other"}` as Key);
    line = props.t("session.turnFailedWhy", { reason, seconds });
  }
  return (
    <div
      data-slot="turn-result"
      className={cn(
        "text-muted-foreground text-xs tabular-nums",
        item.isError && "text-status-error",
      )}
    >
      {line + cost}
    </div>
  );
}

/**
 * One message of the conversation. It takes only what it draws (not the whole session), and the
 * clock only when it is a request waiting, so a token on the way leaves the finished messages
 * alone: that is what keeps a long conversation from being drawn again on every word.
 */
export const TimelineItem = memo(function TimelineItem(props: {
  item: ChatItem;
  toolResults: SessionState["toolResults"];
  cwd: string | null;
  actions: SessionActions;
  alwaysAllow: boolean;
  t: T;
  nowMs: number;
  pin: { pinned: boolean; toggle(): void } | undefined;
  /** Set on the latest assistant message only. */
  fork: (() => void) | undefined;
  /** Phase 39: an OpenCode session's timeline. */
  opencode: boolean;
}) {
  const { item } = props;
  switch (item.kind) {
    case "user":
      return (
        <Message from="user">
          {item.text}
          {item.images ? (
            <div className="text-muted-foreground text-xs">
              {props.t("session.imagesSent", { count: String(item.images) })}
            </div>
          ) : null}
        </Message>
      );
    case "assistant":
      return (
        <AssistantMessage
          item={item}
          toolResults={props.toolResults}
          t={props.t}
          actions={props.actions}
          pin={props.pin}
          fork={props.fork}
        />
      );
    case "permission":
      return (
        <>
          <PermissionItem {...props} item={item} />
          {/* OpenCode ends the turn on a reject (ACP's reject carries no message). */}
          {props.opencode && item.resolution?.decision === "deny" && (
            <div className="text-muted-foreground text-xs">{props.t("session.openCodeDenied")}</div>
          )}
        </>
      );
    case "context":
      return (
        <div className="text-muted-foreground text-xs">
          {props.t(item.sent ? "session.contextSent" : "session.contextSkipped")}
        </div>
      );
    case "result":
      return <TurnResult item={item} t={props.t} />;
    case "persona":
      return (
        <div className="text-muted-foreground text-xs">
          {props.t(item.applied ? "session.personaApplied" : "session.personaCleared", {
            name: item.name,
          })}
        </div>
      );
    case "gap":
      return <div className="text-muted-foreground text-xs">{props.t("session.historyGap")}</div>;
    case "error":
      return (
        <div className="rounded-md border border-status-error/40 p-3 text-sm text-status-error">
          {errorText(item, props.t)}
        </div>
      );
  }
});
