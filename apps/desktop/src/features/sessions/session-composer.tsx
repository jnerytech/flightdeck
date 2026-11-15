import type { EffortLevel } from "@flightdeck/protocol";
import { AtSign, BookText, CornerDownLeft, Plus, Square } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useWand, type WandBinding } from "@/features/assistant/index.ts";
import { WandButton, WandPanel } from "@/features/assistant/ui.ts";
import type { PromptSnippets } from "@/features/snippets/index.ts";
import { PromptMenu } from "@/features/snippets/ui.ts";
import { ActionButton, ConfirmDialog, IconActionButton } from "@/shared/feedback/index.ts";
import { isBusy } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import { ActivityLine } from "./activity-line";
import { ComposerAttachments } from "./composer-attachments.tsx";
import { type ComposerPickersProps, composerPickers } from "./composer-pickers.tsx";
import { ComposerQueue } from "./composer-queue.tsx";
import { commandItemsOf, offeredPrompts } from "./domain/command-menu.ts";
import { interruptOnEscape, submitAction } from "./domain/composer-queue.ts";
import { nextMode } from "./domain/mode-menu.ts";
import { activityOf } from "./domain/session-activity.ts";
import type { SessionState } from "./domain/session-state.ts";
import { Composer, ComposerDock } from "./parts";
import type { SessionActions } from "./session-actions.ts";
import { SessionStatusLine } from "./status-line";
import { useComposerImages } from "./use-composer-images.ts";
import { useComposerQueue } from "./use-composer-queue.ts";
import { useModePick } from "./use-mode-pick.ts";

/** What the message box reads of the session view's props. */
interface SessionComposerProps extends ComposerPickersProps {
  title: string;
  session: SessionState;
  actions: SessionActions;
  t: T;
  /** Names this conversation so the permission mode keeps its place when the person comes back. */
  scrollKey?: string;
  /** Text handed to the message box from elsewhere (a review from Changes); taken once, then reported. */
  composerFill?: string | null;
  onComposerFilled?(): void;
  /** Phase 18: the prompt snippets `/` offers in the message box, and the text of the chosen one. */
  prompts?: PromptSnippets;
  /** The host announces `session.images`: the message box takes pasted or dropped images. */
  images?: boolean;
  /** The host lets the session switch to bypassPermissions: its name, for the confirmation. */
  bypass?: { host: string };
  /** The prompt cache countdown of an idle session, shown next to the model. */
  cache?: ReactNode;
  /** Renders a picker for a folder; `done` gets the path chosen, or null when it was closed. */
  pickPath?: (done: (path: string | null) => void) => ReactNode;
  /** The AI wand of the message box (phase 40): the assistant and where "no provider" goes. */
  assist?: WandBinding;
}

/** The message box of a session: text, images, queue, wand, pickers and the status line. */
export function SessionComposer(props: Readonly<SessionComposerProps>) {
  const { session, actions, t } = props;
  const cards = session.items.length;
  const [text, setText] = useState("");
  const wand = useWand(props.assist, text, setText);
  const [picking, setPicking] = useState(false);
  const opencode = props.runtime === "opencode";
  const { mode, modeMenu, chooseMode, bypassAsk, cancelBypass, confirmBypass } = useModePick({
    session,
    scrollKey: props.scrollKey,
    actions,
    bypassAllowed: Boolean(props.bypass),
    opencode,
  });
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

  const { attached, setAttached, refusal, setRefusal, attach } = useComposerImages(props.images);

  const { queued, enqueue, remove } = useComposerQueue({
    send: actions.send,
    working,
    closed,
    cards,
  });

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
      enqueue({ text: value, images: attached });
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
    <>
      <ComposerDock>
        <PromptMenu
          prompts={offered}
          text={text}
          label={t("session.snippets")}
          onFill={setText}
          input={box}
        />
        <ComposerQueue
          t={t}
          queued={queued}
          onEdit={(item, at) => {
            remove(at);
            setText(item.text);
            setAttached(item.images);
            box.current?.focus();
          }}
          onRemove={remove}
        />
        <ComposerAttachments
          t={t}
          attached={attached}
          refusal={refusal}
          onRemove={(at) => setAttached((before) => before.filter((_, i) => i !== at))}
        />
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
            onCancel={cancelBypass}
            onConfirm={confirmBypass}
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
    </>
  );
}
