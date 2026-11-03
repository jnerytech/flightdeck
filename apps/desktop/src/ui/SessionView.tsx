import type { PermissionMode, PermissionUpdate, SettableMode } from "@flightdeck/protocol";
import { ArrowDown, AtSign, BookText, Square } from "lucide-react";
import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { ActionButton } from "@/components/feedback/action-button";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { NativeSelect } from "@/components/layout/form";
import {
  Composer,
  Message,
  SessionHeader,
  SessionPane,
  Timeline,
} from "@/components/session/parts";
import { PromptMenu, type PromptSnippets } from "@/components/snippets/prompt-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { T } from "../i18n/index.ts";
import { usd } from "../lib/costs.ts";
import type { ChatItem, SessionState } from "../lib/session-state.ts";
import { isBusy } from "../lib/status.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Markdown } from "./Markdown.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { ToolCall } from "./ToolCall.tsx";

/** The permission modes a live session can switch between, and the model aliases it takes. */
const MODES = ["plan", "default", "acceptEdits"] as const;
const ALL_MODES = [...MODES, "bypassPermissions"] as const;
const MODELS = ["opus", "sonnet", "haiku"] as const;

/** How far from the end still counts as being at the end, in pixels. */
const END_SLACK = 24;

export interface SessionActions {
  /** Copies a text (the approval's folder); the app's store does. */
  copyText?(text: string): Promise<boolean>;
  send(text: string): Promise<void>;
  /** Changes the permission mode / the model (null: the default) of the open session. */
  setMode?(mode: SettableMode): Promise<void>;
  setModel?(model: string | null): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  resume(): Promise<void>;
  respond(
    requestId: string,
    decision: "allow" | "deny",
    message?: string,
    updatedPermissions?: PermissionUpdate[],
    updatedInput?: Record<string, unknown>,
  ): Promise<void>;
}

type Item<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;

function AssistantMessage(props: {
  item: Item<"assistant">;
  toolResults: SessionState["toolResults"];
}) {
  return (
    <Message from="assistant">
      {props.item.blocks.map((block, i) =>
        block.type === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are immutable and ordered
          <Markdown key={i} text={block.text} />
        ) : (
          <ToolCall
            key={block.id}
            name={block.name}
            input={block.input}
            result={props.toolResults[block.id]}
          />
        ),
      )}
    </Message>
  );
}

function PermissionItem(props: {
  item: Item<"permission">;
  cwd: string | null;
  actions: SessionActions;
  alwaysAllow: boolean;
  t: T;
  nowMs: number;
}) {
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
      onRespond={(decision, message, updates, updatedInput) =>
        actions.respond(item.requestId, decision, message, updates, updatedInput)
      }
    />
  );
}

function TurnResult(props: { item: Item<"result">; t: T }) {
  const { item } = props;
  const cost = item.costUsd !== undefined ? ` · US$ ${item.costUsd.toFixed(4)}` : "";
  const key = item.isError ? "session.turnFailed" : "session.turnDone";
  return (
    <div
      className={cn(
        "text-muted-foreground text-xs tabular-nums",
        item.isError && "text-status-error",
      )}
    >
      {props.t(key, { seconds: (item.durationMs / 1000).toFixed(1) }) + cost}
    </div>
  );
}

/**
 * One message of the conversation. It takes only what it draws (not the whole session), and the
 * clock only when it is a request waiting, so a token on the way leaves the finished messages
 * alone: that is what keeps a long conversation from being drawn again on every word.
 */
const TimelineItem = memo(function TimelineItem(props: {
  item: ChatItem;
  toolResults: SessionState["toolResults"];
  cwd: string | null;
  actions: SessionActions;
  alwaysAllow: boolean;
  t: T;
  nowMs: number;
}) {
  const { item } = props;
  switch (item.kind) {
    case "user":
      return <Message from="user">{item.text}</Message>;
    case "assistant":
      return <AssistantMessage item={item} toolResults={props.toolResults} />;
    case "permission":
      return <PermissionItem {...props} item={item} />;
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
        <div className="rounded-md border border-status-error/40 p-3 text-sm text-status-error">{`${item.code}: ${item.message}`}</div>
      );
  }
});

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
  /** "Aplicar persona" (phase 20), when the host keeps personas. */
  persona?: ReactNode;
  /** The session's summary (phase 30), once Claude Code named the session. */
  recap?: ReactNode;
  /** Estimated cost of the session and its subagents (phase 8); `null` when unknown. */
  costUsd?: number | null;
  /** The app's translator and clock (phase 10); pt-BR and the real clock when absent. */
  t?: T;
  nowMs?: number;
  /** Phase 18: the prompt snippets `/` offers in the message box, and the text of the chosen one. */
  prompts?: PromptSnippets;
  /** The host announces `session.settings` and the session is a managed one. */
  settings?: boolean;
  /** The host lets the session switch to bypassPermissions: its name, for the confirmation. */
  bypass?: { host: string };
  /** Renders a picker for a folder; `done` gets the path chosen, or null when it was closed. */
  pickPath?: (done: (path: string | null) => void) => ReactNode;
}) {
  const ctx = useT();
  const t = props.t ?? ctx;
  const { focusRequestId } = props;
  const timeline = useRef<HTMLDivElement>(null);
  const cards = props.session.items.length;
  // Whether the reader is at the end: only then does a new message pull the view down.
  const following = useRef(!focusRequestId);
  const [away, setAway] = useState(false);
  const streaming = props.session.streaming;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new message or token is when the end moves
  useLayoutEffect(() => {
    const box = timeline.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [cards, streaming]);
  useEffect(() => {
    if (!focusRequestId || cards === 0) return;
    const card = timeline.current?.querySelector(`[data-request-id="${focusRequestId}"]`);
    card?.scrollIntoView?.({ block: "center" });
  }, [focusRequestId, cards]);
  const { session, actions } = props;
  const [text, setText] = useState("");
  const [closing, setClosing] = useState(false);
  const [picking, setPicking] = useState(false);
  const start = session.permissionMode ?? "default";
  const [mode, setMode] = useState<PermissionMode>(start);
  // As strict as the start mode or stricter; a start mode outside the list (bypass, auto) gets all.
  const at = MODES.indexOf(start as (typeof MODES)[number]);
  const limit = at < 0 ? MODES.length : at + 1;
  // A host that allows bypass lets the person pick any mode, looser than the start included.
  const offeredModes = props.bypass ? ALL_MODES : MODES.slice(0, limit);
  const [bypassAsk, setBypassAsk] = useState(false);
  const [model, setModel] = useState("");
  const slash = session.slashCommands;
  // Typing `/` offers the snippets and the commands of the session together.
  const offered: PromptSnippets | undefined = useMemo(
    () =>
      props.prompts || slash
        ? {
            list: async () => [
              ...((await props.prompts?.list()) ?? []),
              ...(slash ?? []).map((name) => ({ key: `slash:${name}`, name: `/${name}` })),
            ],
            fill: async (key) =>
              key.startsWith("slash:") ? `/${key.slice(6)} ` : (props.prompts?.fill(key) ?? ""),
          }
        : undefined,
    [props.prompts, slash],
  );
  const working = isBusy(session.status);
  const closed = session.status === "ended" || session.status === "error";

  const box = useRef<HTMLTextAreaElement>(null);
  /** The session is being ended: Encerrar is busy until the daemon says so. */
  const [ending, setEnding] = useState(false);

  const submit = () => {
    const value = text.trim();
    if (!value) {
      // A click with nothing to send is not dead: the cursor goes where the text is typed.
      box.current?.focus();
      return undefined;
    }
    setText("");
    return actions.send(value);
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
              <ActionButton variant="outline" size="sm" onClick={() => actions.resume()}>
                {t("session.resume")}
              </ActionButton>
            ) : (
              <>
                <ActionButton
                  variant="outline"
                  size="sm"
                  pending={ending}
                  onClick={() => setClosing(true)}
                >
                  {t("session.end")}
                </ActionButton>
                {closing && (
                  <ConfirmDialog
                    message={t("session.endMessage")}
                    confirmLabel={t("session.endConfirm")}
                    destructive
                    onConfirm={() => {
                      setClosing(false);
                      setEnding(true);
                      void actions.close().finally(() => setEnding(false));
                    }}
                    onCancel={() => setClosing(false)}
                  />
                )}
              </>
            )}
          </>
        }
        extra={props.persona}
      />
      {props.recap}
      <div className="pane-fill">
        <Timeline
          ref={timeline}
          onScroll={(e) => {
            const box = e.currentTarget;
            const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight <= END_SLACK;
            following.current = atEnd;
            setAway(!atEnd);
          }}
        >
          {session.pruned && session.items.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("session.pruned")}</p>
          )}
          {session.items.map((item) => (
            <TimelineItem
              key={item.seq}
              item={item}
              toolResults={session.toolResults}
              cwd={session.cwd ?? null}
              actions={actions}
              alwaysAllow={props.alwaysAllow === true}
              t={t}
              nowMs={item.kind === "permission" ? (props.nowMs ?? Date.now()) : 0}
            />
          ))}
          {session.streaming && (
            <Message from="assistant" className="opacity-80">
              {session.streaming}
            </Message>
          )}
        </Timeline>
        {away && (
          <Button
            size="sm"
            className="float-end shadow-md"
            onClick={() => {
              const box = timeline.current;
              if (box) box.scrollTop = box.scrollHeight;
              following.current = true;
              setAway(false);
            }}
          >
            <ArrowDown aria-hidden="true" />
            {t("session.jumpLatest")}
          </Button>
        )}
      </div>
      <PromptMenu prompts={offered} text={text} label={t("session.snippets")} onFill={setText} />
      <Composer>
        {props.prompts && (
          <IconActionButton
            label={t("session.insertSnippet")}
            onClick={() => {
              setText("/");
              box.current?.focus();
            }}
          >
            <BookText aria-hidden="true" />
          </IconActionButton>
        )}
        {props.pickPath && (
          <IconActionButton label={t("session.mentionFolder")} onClick={() => setPicking(true)}>
            <AtSign aria-hidden="true" />
          </IconActionButton>
        )}
        {props.settings && actions.setMode && (
          <NativeSelect
            compact
            inline
            aria-label={t("session.modeLabel")}
            value={mode}
            onChange={(e) => {
              const next = e.target.value as SettableMode;
              if (next === "bypassPermissions") {
                setBypassAsk(true);
                return;
              }
              setMode(next);
              void actions.setMode?.(next);
            }}
          >
            {offeredModes.map((value) => (
              <option key={value} value={value}>
                {t(`modes.${value}.name`)}
              </option>
            ))}
          </NativeSelect>
        )}
        {bypassAsk && props.bypass && (
          <ConfirmDialog
            destructive
            message={t("session.bypassMessage", { host: props.bypass.host, session: props.title })}
            confirmLabel={t("session.bypassConfirm")}
            onCancel={() => setBypassAsk(false)}
            onConfirm={() => {
              setBypassAsk(false);
              setMode("bypassPermissions");
              void actions.setMode?.("bypassPermissions");
            }}
          />
        )}
        {props.settings && actions.setModel && (
          <NativeSelect
            compact
            inline
            aria-label={t("session.modelLabel")}
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              void actions.setModel?.(e.target.value || null);
            }}
          >
            <option value="">{t("session.modelDefault")}</option>
            {MODELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        )}
        <Textarea
          ref={box}
          aria-label={t("session.message")}
          placeholder={t("session.placeholder")}
          value={text}
          className="max-h-40 min-h-9 flex-1 resize-none"
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && working) void actions.interrupt();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {working ? (
          <>
            <output aria-live="polite" aria-label={t("session.working")} className="sr-only">
              {t("session.working")}
            </output>
            <ActionButton
              variant="destructive"
              aria-label={t("session.stopTurn")}
              onClick={() => actions.interrupt()}
            >
              <Square aria-hidden="true" />
              {t("session.interrupt")}
            </ActionButton>
          </>
        ) : (
          <ActionButton onClick={submit}>{t("session.send")}</ActionButton>
        )}
      </Composer>
      {picking &&
        props.pickPath?.((path) => {
          setPicking(false);
          if (path) setText((before) => `${before}@${path} `);
          box.current?.focus();
        })}
    </SessionPane>
  );
}
