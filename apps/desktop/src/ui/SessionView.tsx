import {
  type PermissionMode,
  type PermissionUpdate,
  SESSION_IMAGE_MAX_BYTES,
  SESSION_IMAGE_MAX_COUNT,
  type SessionImage,
  type SettableMode,
} from "@flightdeck/protocol";
import { ArrowDown, AtSign, BookText, CornerDownLeft, Plus, Square, X } from "lucide-react";
import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval/approval-card";
import { ActionButton } from "@/components/feedback/action-button";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { NativeSelect } from "@/components/layout/form";
import { MODELS } from "@/components/personas/model-select";
import { ActivityLine } from "@/components/session/activity-line";
import { MessageActions } from "@/components/session/message-actions";
import {
  Composer,
  ComposerDock,
  Message,
  SessionHeader,
  SessionPane,
  Timeline,
} from "@/components/session/parts";
import { SessionStatusLine } from "@/components/session/status-line";
import { WorkingRow } from "@/components/session/working-row";
import { PromptMenu, type PromptSnippets } from "@/components/snippets/prompt-menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { T } from "../i18n/index.ts";
import { usd } from "../lib/costs.ts";
import { activityOf } from "../lib/session-activity.ts";
import { type ImageRefusal, readImage, refuseImage } from "../lib/session-images.ts";
import type { ChatItem, SessionState } from "../lib/session-state.ts";
import { isBusy } from "../lib/status.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Markdown } from "./Markdown.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { ToolCall } from "./ToolCall.tsx";

/** The permission modes a live session can switch between. */
const MODES = ["plan", "default", "acceptEdits"] as const;
const ALL_MODES = [...MODES, "bypassPermissions"] as const;

/** How far from the end still counts as being at the end, in pixels. */
const END_SLACK = 24;

export interface SessionActions {
  /** Copies a text (the approval's folder); the app's store does. */
  copyText?(text: string): Promise<boolean>;
  send(text: string, images?: SessionImage[]): Promise<void>;
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
  t: T;
  actions: SessionActions;
  pin: SessionViewProps["pin"];
  /** Only the latest message offers Fork. */
  fork: SessionViewProps["fork"];
}) {
  const text = props.item.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n");
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
  pin: SessionViewProps["pin"];
  /** Set on the latest assistant message only. */
  fork: SessionViewProps["fork"];
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

interface SessionViewProps {
  title: string;
  session: SessionState;
  actions: SessionActions;
  focusRequestId?: string | null;
  /** Names this conversation so its scroll position is kept when the person comes back to the tab. */
  scrollKey?: string;
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
  /** The host announces `session.images`: the message box takes pasted or dropped images. */
  images?: boolean;
  /** The host announces `session.settings` and the session is a managed one. */
  settings?: boolean;
  /** The host lets the session switch to bypassPermissions: its name, for the confirmation. */
  bypass?: { host: string };
  /** Pins or unpins the session; its button sits in each assistant message's action row. */
  pin?: { pinned: boolean; toggle(): void };
  /** Forks the conversation at its latest message; offered on that message only. */
  fork?: () => void;
  /** Renders a picker for a folder; `done` gets the path chosen, or null when it was closed. */
  pickPath?: (done: (path: string | null) => void) => ReactNode;
}

/** Chat history in streaming, tool calls, approval cards, message box and session controls. */
export function SessionView(props: SessionViewProps) {
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
  const latestAssistant = [...session.items]
    .reverse()
    .find((item) => item.kind === "assistant")?.seq;
  const working = isBusy(session.status);
  const activity = activityOf(session);
  const closed = session.status === "ended" || session.status === "error";

  const box = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  /** Where the cursor goes once Ctrl+Enter has put a line break in the text. */
  const caret = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the new text is when the cursor moves
  useLayoutEffect(() => {
    if (caret.current !== null) box.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  /** The session is being ended: Encerrar is busy until the daemon says so. */
  const [ending, setEnding] = useState(false);

  /** The images waiting to go with the next message, and why the last file was turned away. */
  const [attached, setAttached] = useState<SessionImage[]>([]);
  const [refusal, setRefusal] = useState<ImageRefusal | null>(null);
  const attach = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!props.images || images.length === 0) return;
    let have = attached.length;
    const taken: SessionImage[] = [];
    let turned: ImageRefusal | null = null;
    for (const file of images) {
      const why = refuseImage(file, have);
      if (why) turned = why;
      else {
        taken.push(await readImage(file));
        have++;
      }
    }
    setRefusal(turned);
    if (taken.length > 0) setAttached((before) => [...before, ...taken]);
  };

  /** Messages written during a turn: they wait here and go out, in order, as the turns end. */
  const [queued, setQueued] = useState<Array<{ text: string; images: SessionImage[] }>>([]);
  /** A queued message went out and its turn has not shown up yet: the next one waits for it. */
  const awaiting = useRef<number | null>(null);
  const nextQueued = queued[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: the head of the queue is what it reads
  useEffect(() => {
    // The turn showed up (the session worked, or its user message reached the conversation).
    if (awaiting.current !== null && (working || cards > awaiting.current)) awaiting.current = null;
    if (working || closed || !nextQueued || awaiting.current !== null) return;
    awaiting.current = cards;
    void actions
      .send(nextQueued.text, nextQueued.images.length > 0 ? nextQueued.images : undefined)
      .then(() => setQueued((rest) => rest.slice(1)))
      .catch(() => {
        awaiting.current = null;
      });
  }, [working, closed, nextQueued, cards]);

  const submit = () => {
    const value = text.trim();
    if (!value && attached.length === 0) {
      // A click with nothing to send is not dead: the cursor goes where the text is typed.
      box.current?.focus();
      return undefined;
    }
    setText("");
    setAttached([]);
    setRefusal(null);
    if (working) {
      setQueued((before) => [...before, { text: value, images: attached }]);
      return undefined;
    }
    return actions.send(value, attached.length > 0 ? attached : undefined);
  };

  const pickers = {
    ...(props.settings && actions.setModel
      ? {
          model: (
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
          ),
        }
      : {}),
    ...(props.settings && actions.setMode
      ? {
          mode: (
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
          ),
        }
      : {}),
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
              pin={props.pin}
              fork={item.seq === latestAssistant ? props.fork : undefined}
            />
          ))}
          {session.streaming && (
            <Message from="assistant" className="opacity-80">
              {session.streaming}
            </Message>
          )}
          {(session.status === "running" || session.status === "starting") && (
            <WorkingRow
              label={t("session.working")}
              since={session.busySince ?? props.nowMs ?? Date.now()}
              tool={openTool(session)}
              {...(props.nowMs !== undefined ? { nowMs: props.nowMs } : {})}
            />
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
      <ComposerDock>
        <PromptMenu prompts={offered} text={text} label={t("session.snippets")} onFill={setText} />
        {queued.length > 0 && (
          <ul aria-label={t("session.queue")} className="composer-images">
            {queued.map((item, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the queue is only ever edited by position
              <li key={at} className="composer-queued">
                <span className="min-w-0 flex-1 truncate text-sm">{item.text}</span>
                {item.images.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {t("session.imagesSent", { count: String(item.images.length) })}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("session.queueEdit", { text: item.text })}
                  onClick={() => {
                    setQueued((before) => before.filter((_, i) => i !== at));
                    setText(item.text);
                    setAttached(item.images);
                    box.current?.focus();
                  }}
                >
                  {t("session.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("session.queueRemove", { text: item.text })}
                  onClick={() => setQueued((before) => before.filter((_, i) => i !== at))}
                >
                  {t("session.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {(attached.length > 0 || refusal) && (
          <div className="composer-images">
            {attached.map((image, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two pasted copies of one image look the same
              <div key={`${at}:${image.data.slice(-16)}`} className="composer-image">
                <img
                  alt={t("session.imageAttached", { n: String(at + 1) })}
                  src={`data:${image.mediaType};base64,${image.data}`}
                  className="composer-thumb"
                />
                <IconActionButton
                  label={t("session.imageRemove", { n: String(at + 1) })}
                  onClick={() => setAttached((before) => before.filter((_, i) => i !== at))}
                >
                  <X aria-hidden="true" />
                </IconActionButton>
              </div>
            ))}
            {refusal && (
              <p role="alert" className="text-status-error text-xs">
                {t(`session.imageRefused.${refusal}`, {
                  max: String(
                    refusal === "size"
                      ? SESSION_IMAGE_MAX_BYTES / (1024 * 1024)
                      : SESSION_IMAGE_MAX_COUNT,
                  ),
                })}
              </p>
            )}
          </div>
        )}
        {working && <ActivityLine activity={activity} t={t} />}
        <Composer>
          {props.images && (
            <>
              <IconActionButton label={t("session.attach")} onClick={() => files.current?.click()}>
                <Plus aria-hidden="true" />
              </IconActionButton>
              <input
                ref={files}
                type="file"
                multiple
                hidden
                aria-hidden="true"
                tabIndex={-1}
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => {
                  void attach(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </>
          )}
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
          <Textarea
            ref={box}
            aria-label={t("session.message")}
            placeholder={t("session.placeholder")}
            title={t("session.shortcuts")}
            aria-keyshortcuts="Enter"
            value={text}
            className="composer-box max-h-40 min-h-9 flex-1 resize-none"
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (props.images && files.some((file) => file.type.startsWith("image/"))) {
                e.preventDefault();
                void attach(files);
              }
            }}
            onDragOver={(e) => props.images && e.preventDefault()}
            onDrop={(e) => {
              if (!props.images) return;
              e.preventDefault();
              void attach(Array.from(e.dataTransfer?.files ?? []));
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && working) void actions.interrupt();
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              if (e.ctrlKey || e.metaKey) {
                // Ctrl+Enter breaks the line where the cursor is (a textarea only does it for Shift).
                e.preventDefault();
                const field = e.currentTarget;
                const at = field.selectionStart;
                caret.current = at + 1;
                setText(`${text.slice(0, at)}\n${text.slice(field.selectionEnd)}`);
              } else if (!e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {working ? (
            <>
              <ActionButton variant="outline" aria-keyshortcuts="Enter" onClick={submit}>
                {t("session.queueAdd")}
              </ActionButton>
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
            (text.trim() !== "" || attached.length > 0) && (
              <ActionButton
                size="icon"
                aria-label={t("session.send")}
                aria-keyshortcuts="Enter"
                onClick={submit}
              >
                <CornerDownLeft aria-hidden="true" />
              </ActionButton>
            )
          )}
        </Composer>
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
        <SessionStatusLine
          t={t}
          model={session.model}
          mode={session.permissionMode ?? "default"}
          pickers={pickers}
          working={working}
        />
      </ComposerDock>
      {picking &&
        props.pickPath?.((path) => {
          setPicking(false);
          if (path) setText((before) => `${before}@${path} `);
          box.current?.focus();
        })}
    </SessionPane>
  );
}

/** The tool the turn is in: the last one called that has not answered yet. */
function openTool(session: SessionState): string | null {
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i];
    if (item?.kind !== "assistant") continue;
    for (let j = item.blocks.length - 1; j >= 0; j--) {
      const block = item.blocks[j];
      if (block?.type === "tool_use" && !(block.id in session.toolResults)) return block.name;
    }
    return null;
  }
  return null;
}
