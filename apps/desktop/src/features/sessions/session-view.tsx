import {
  type EffortLevel,
  inSequence,
  type PermissionMode,
  SESSION_IMAGE_MAX_BYTES,
  SESSION_IMAGE_MAX_COUNT,
  type SessionImage,
  type SettableMode,
} from "@flightdeck/protocol";
import { ArrowDown, AtSign, BookText, CornerDownLeft, Plus, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWand, type WandBinding } from "@/features/assistant/index.ts";
import { WandButton, WandPanel } from "@/features/assistant/ui.ts";
import type { MenuItem, PromptSnippets } from "@/features/snippets/index.ts";
import { PromptMenu } from "@/features/snippets/ui.ts";
import { useT } from "@/i18n/context";
import { ActionButton, ConfirmDialog, IconActionButton } from "@/shared/feedback/index.ts";
import { NativeSelect } from "@/shared/layout/index.ts";
import { isBusy } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import { usd } from "../costs/index.ts";
import { ActivityLine } from "./activity-line";
import { commandItemsOf, slashFill } from "./domain/command-menu.ts";
import { composerModeMenu, offersModelPicker } from "./domain/composer-pickers.ts";
import { interruptOnEscape, queueStep, submitAction } from "./domain/composer-queue.ts";
import { nextMode } from "./domain/mode-menu.ts";
import { activityOf } from "./domain/session-activity.ts";
import { type ImageRefusal, readImage, refuseImage } from "./domain/session-images.ts";
import type { SessionState } from "./domain/session-state.ts";
import { EndWithChangesDialog } from "./end-with-changes-dialog.tsx";
import { ModeChip } from "./mode-chip";
import { ModelChip } from "./model-chip";
import { ModelOptions } from "./model-options.tsx";
import {
  Composer,
  ComposerDock,
  Message,
  RecapSlot,
  SessionHeader,
  SessionPane,
  Timeline,
} from "./parts";
import { RuntimeBadge } from "./runtime-badge";
import type { SessionActions } from "./session-actions.ts";
import { StatusBadge } from "./status-badge.tsx";
import { SessionStatusLine } from "./status-line";
import { TimelineItem } from "./timeline-item.tsx";
import { useConversationScroll } from "./use-conversation-scroll.ts";
import { WorkingRow } from "./working-row";

interface SessionViewProps {
  title: string;
  /**
   * #1133: how many files the session's checkout has not committed, asked when End is pressed.
   * Absent: End only confirms.
   */
  uncommitted?: () => Promise<number>;
  /** #1133: shows the session's Changes, where those files are committed. */
  onCommitFirst?: () => void;
  session: SessionState;
  actions: SessionActions;
  focusRequestId?: string | null;
  /** Names this conversation so its scroll position is kept when the person comes back to the tab. */
  scrollKey?: string;
  /** Text handed to the message box from elsewhere (a review from Changes); taken once, then reported. */
  composerFill?: string | null;
  onComposerFilled?(): void;
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
  /** The turns a session resumed from History had before (issue #108), above the new ones. */
  earlier?: ReactNode;
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
  /** Opens the host's page, where the bypass switch is (the mode menu links to it). */
  onOpenHostSettings?: () => void;
  /** The host lets the session switch to bypassPermissions: its name, for the confirmation. */
  bypass?: { host: string };
  /** Pins or unpins the session; its button sits in each assistant message's action row. */
  pin?: { pinned: boolean; toggle(): void };
  /** The prompt cache countdown of an idle session, shown next to the model. */
  cache?: ReactNode;
  /** Forks the conversation at its latest message; offered on that message only. */
  fork?: () => void;
  /** Phase 39: the agent; an OpenCode session says so and offers no fork. */
  runtime?: "claude" | "opencode";
  /** The host changes the effort of a live session (`session.effort`). */
  effort?: boolean;
  /** Phase 39: OpenCode's models, for the live switch of an OpenCode session (none until known). */
  models?: readonly string[];
  /** Renders a picker for a folder; `done` gets the path chosen, or null when it was closed. */
  pickPath?: (done: (path: string | null) => void) => ReactNode;
  /** The AI wand of the message box (phase 40): the assistant and where "no provider" goes. */
  assist?: WandBinding;
}

/** The snippets of the host and the commands of the session behind one `/` menu. */
function offeredPrompts(
  prompts: PromptSnippets | undefined,
  slash: SessionViewProps["session"]["slashCommands"],
  commandItems: MenuItem[],
): PromptSnippets | undefined {
  if (!prompts && !slash) return undefined;
  return {
    list: async () => [...((await prompts?.list()) ?? []), ...commandItems],
    fill: async (key) => slashFill(key) ?? (await prompts?.fill(key)) ?? "",
  };
}

/** What the composer's pickers hold: the person's picks, and how a pick is made. */
interface PickerState {
  model: string;
  setModel(value: string): void;
  effort: EffortLevel | null;
  setEffort(level: EffortLevel | null): void;
  mode: PermissionMode | null;
  modeMenu: ReturnType<typeof composerModeMenu>;
  chooseMode(next: SettableMode): void;
}

/** The pickers of what the session lets change (model and effort, mode); the rest shows as text. */
function composerPickers(
  props: SessionViewProps,
  t: T,
  state: PickerState,
): { model?: ReactNode; mode?: ReactNode } {
  const { actions, session } = props;
  const opencode = props.runtime === "opencode";
  const pickers: { model?: ReactNode; mode?: ReactNode } = {};
  if (
    offersModelPicker({
      settings: Boolean(props.settings),
      canSetModel: Boolean(actions.setModel),
      opencode,
      hasModels: Boolean(props.models),
    })
  ) {
    pickers.model = opencode ? (
      <NativeSelect
        compact
        inline
        aria-label={t("session.modelLabel")}
        value={state.model}
        onChange={(e) => {
          state.setModel(e.target.value);
          void actions.setModel?.(e.target.value || null);
        }}
      >
        <option value="">{t("session.modelDefault")}</option>
        <ModelOptions models={props.models ?? []} />
      </NativeSelect>
    ) : (
      <ModelChip
        t={t}
        model={state.model}
        current={session.model}
        effort={state.effort}
        effortAvailable={Boolean(props.effort && actions.setEffort)}
        onPickModel={(value) => {
          state.setModel(value);
          void actions.setModel?.(value || null);
        }}
        onPickEffort={(level) => {
          state.setEffort(level);
          void actions.setEffort?.(level);
        }}
      />
    );
  }
  if (props.settings && actions.setMode) {
    pickers.mode = (
      <ModeChip
        t={t}
        mode={state.mode}
        rows={state.modeMenu}
        onPick={state.chooseMode}
        onOpenHostSettings={props.onOpenHostSettings}
      />
    );
  }
  return pickers;
}

/** Chat history in streaming, tool calls, approval cards, message box and session controls. */
export function SessionView(props: Readonly<SessionViewProps>) {
  const ctx = useT();
  const t = props.t ?? ctx;
  const { focusRequestId } = props;
  const cards = props.session.items.length;
  const { timeline, away, missed, handlers, jumpToEnd } = useConversationScroll({
    session: props.session,
    focusRequestId,
    scrollKey: props.scrollKey,
  });
  const jumpKey = missed === 1 ? "session.jumpLatestOne" : "session.jumpLatestMany";
  const { session, actions } = props;
  const [text, setText] = useState("");
  const wand = useWand(props.assist, text, setText);
  const [closing, setClosing] = useState(false);
  // #1133: how many files End found uncommitted, while it asks about them.
  const [unsaved, setUnsaved] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  // The session's own mode, null until it says (#935): never a guess of Default.
  const start = session.permissionMode ?? null;
  // The mode it runs in now: the last one it reported, else the one it opened with.
  const current = session.mode ?? start;
  // A pick belongs to the session and the mode it was made over: another session, or a new mode
  // from this one, shows its own.
  const owner = `${props.scrollKey ?? ""}|${current ?? ""}`;
  const [picks, setPicks] = useState<Readonly<Record<string, PermissionMode>>>({});
  const mode = picks[owner] ?? current;
  /**
   * Shows the pick at once and asks the host; a refusal (said in the error bar) takes it back, so
   * the chip shows the session's own mode again (#935).
   */
  const pickMode = (next: SettableMode) => {
    const key = owner;
    setPicks((all) => ({ ...all, [key]: next }));
    void actions.setMode?.(next).then((taken) => {
      if (taken !== false) return;
      setPicks(({ [key]: _refused, ...rest }) => rest);
    });
  };
  const [bypassAsk, setBypassAsk] = useState(false);
  const opencode = props.runtime === "opencode";
  const fork = opencode ? undefined : props.fork;
  // OpenCode has no accept-edits mode: the menu lists the others and the numbers follow.
  const modeMenu = composerModeMenu({
    current: mode,
    start,
    bypassAllowed: Boolean(props.bypass),
    opencode,
  });
  /** A mode from the menu or Shift+Tab: bypass asks first, any other changes at once. */
  const chooseMode = (next: SettableMode) => {
    if (next === "bypassPermissions") {
      setBypassAsk(true);
      return;
    }
    pickMode(next);
  };
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<EffortLevel | null>(null);
  const slash = session.slashCommands;
  const described = session.commands;
  // A daemon that describes the commands gives each its group and its description; an older one
  // gives the names only, and the menu groups them by the shape of the name.
  const commandItems = useMemo(() => commandItemsOf(described, slash), [described, slash]);
  // Typing `/` offers the snippets and the commands of the session together.
  const offered = useMemo(
    () => offeredPrompts(props.prompts, slash, commandItems),
    [props.prompts, slash, commandItems],
  );
  const latestAssistant = [...session.items]
    .reverse()
    .find((item) => item.kind === "assistant")?.seq;
  const working = isBusy(session.status);
  const activity = activityOf(session);
  const closed = session.status === "ended" || session.status === "error";

  const box = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  // Text handed over from elsewhere (a review from Changes) goes after what is typed, once.
  const { composerFill: fill, onComposerFilled } = props;
  const takenFill = useRef<string | null>(null);
  useEffect(() => {
    if (!fill) {
      takenFill.current = null;
      return;
    }
    if (takenFill.current === fill) return;
    takenFill.current = fill;
    setText((before) => (before.trim() ? `${before}\n\n${fill}` : fill));
    box.current?.focus();
    onComposerFilled?.();
  }, [fill, onComposerFilled]);
  /** Where the cursor goes once Ctrl+Enter has put a line break in the text. */
  const caret = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the new text is when the cursor moves
  useLayoutEffect(() => {
    if (caret.current !== null) box.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  /** The session is being ended: Encerrar is busy until the daemon says so. */
  const [ending, setEnding] = useState(false);
  const end = () => {
    setEnding(true);
    void actions.close().finally(() => setEnding(false));
  };

  /** The images waiting to go with the next message, and why the last file was turned away. */
  const [attached, setAttached] = useState<SessionImage[]>([]);
  const [refusal, setRefusal] = useState<ImageRefusal | null>(null);
  const attach = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!props.images || images.length === 0) return;
    let have = attached.length;
    const taken: SessionImage[] = [];
    let turned: ImageRefusal | null = null;
    await inSequence(images, async (file) => {
      const why = refuseImage(file, have);
      if (why) turned = why;
      else {
        taken.push(await readImage(file));
        have++;
      }
    });
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
    const step = queueStep({
      working,
      closed,
      hasNext: nextQueued !== undefined,
      awaiting: awaiting.current,
      cards,
    });
    awaiting.current = step.awaiting;
    if (!step.send || !nextQueued) return;
    void actions
      .send(nextQueued.text, nextQueued.images.length > 0 ? nextQueued.images : undefined)
      .then(() => setQueued((rest) => rest.slice(1)))
      .catch(() => {
        awaiting.current = null;
      });
  }, [working, closed, nextQueued, cards]);

  const submit = () => {
    const value = text.trim();
    const action = submitAction(value, attached.length, working);
    if (action === "focus") {
      // A click with nothing to send is not dead: the cursor goes where the text is typed.
      box.current?.focus();
      return undefined;
    }
    setText("");
    setAttached([]);
    setRefusal(null);
    if (action === "queue") {
      setQueued((before) => [...before, { text: value, images: attached }]);
      return undefined;
    }
    return actions.send(value, attached.length > 0 ? attached : undefined);
  };

  const pickers = composerPickers(props, t, {
    model,
    setModel,
    effort,
    setEffort,
    mode,
    modeMenu,
    chooseMode,
  });

  return (
    <SessionPane waiting={session.pending.length > 0}>
      <SessionHeader
        title={props.title}
        subtitle={
          <>
            <span>{session.cwd}</span>
            {typeof props.costUsd === "number" && (
              <span>
                {t("session.cost")}{" "}
                <output aria-label={t("session.costLabel")}>{usd(props.costUsd, t.lang)}</output>
              </span>
            )}
          </>
        }
        hint={[session.cwd, typeof props.costUsd === "number" ? usd(props.costUsd, t.lang) : null]
          .filter(Boolean)
          .join(" · ")}
        controls={
          <>
            {opencode && (
              <RuntimeBadge label={t("session.runtimeOpenCode")} slot="session-runtime" />
            )}
            {session.status && <StatusBadge status={session.status} />}
            {session.statusReason && (
              <span className="text-muted-foreground text-xs">{session.statusReason}</span>
            )}
          </>
        }
        actions={
          <>
            {props.timeline}
            {!opencode && props.terminal}
            {closed ? (
              <ActionButton variant="outline" size="sm" onClick={() => actions.resume()}>
                {t("session.resume")}
              </ActionButton>
            ) : (
              <ActionButton
                variant="outline"
                size="sm"
                pending={ending}
                onClick={async () => {
                  const count = props.uncommitted ? await props.uncommitted().catch(() => 0) : 0;
                  if (count > 0) setUnsaved(count);
                  else setClosing(true);
                }}
              >
                {t("session.end")}
              </ActionButton>
            )}
          </>
        }
        dialogs={
          <>
            {closing && (
              <ConfirmDialog
                message={t("session.endMessage")}
                confirmLabel={t("session.endConfirm")}
                destructive
                onConfirm={() => {
                  setClosing(false);
                  end();
                }}
                onCancel={() => setClosing(false)}
              />
            )}
            {unsaved !== null && (
              <EndWithChangesDialog
                t={t}
                files={unsaved}
                onCommit={() => {
                  setUnsaved(null);
                  props.onCommitFirst?.();
                }}
                onEnd={() => {
                  setUnsaved(null);
                  end();
                }}
                onCancel={() => setUnsaved(null)}
              />
            )}
          </>
        }
        extra={opencode ? undefined : props.persona}
      />
      {/* The summary lines up with the header and the conversation (issue #177). */}
      {!opencode && props.recap && <RecapSlot>{props.recap}</RecapSlot>}
      <div className="pane-fill">
        <Timeline ref={timeline} {...handlers}>
          {props.earlier}
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
              fork={item.seq === latestAssistant ? fork : undefined}
              opencode={opencode}
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
          <Button size="sm" className="float-end shadow-md" onClick={jumpToEnd}>
            <ArrowDown aria-hidden="true" />
            {missed === 0 ? t("session.jumpLatest") : t(jumpKey, { n: missed })}
          </Button>
        )}
      </div>
      <ComposerDock>
        <PromptMenu
          prompts={offered}
          text={text}
          label={t("session.snippets")}
          onFill={setText}
          input={box}
        />
        {queued.length > 0 && (
          <ul aria-label={t("session.queue")} className="composer-images">
            {queued.map((item, at) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: the queue is only ever edited by position
                key={at} // NOSONAR: the queue is only ever edited by position
                className="composer-queued"
              >
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
        {wand && <WandPanel wand={wand} t={t} />}
        <Composer busy={working}>
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
          {wand && <WandButton wand={wand} t={t} />}
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
              if (wand?.onKeyDown(e)) return;
              interruptOnEscape(e, working, actions.interrupt);
              if (e.key === "Tab" && e.shiftKey && props.settings && actions.setMode) {
                // Shift+Tab cycles the permission mode, as in Claude Code; with none to go to, focus moves on.
                const next = nextMode(modeMenu, mode);
                if (next) {
                  e.preventDefault();
                  chooseMode(next);
                }
                return;
              }
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
              pickMode("bypassPermissions");
            }}
          />
        )}
        <SessionStatusLine
          t={t}
          model={session.model}
          mode={mode}
          pickers={pickers}
          working={working}
          {...(props.cache ? { cache: props.cache } : {})}
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
