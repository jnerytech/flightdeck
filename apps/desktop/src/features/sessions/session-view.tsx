import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { WandBinding } from "@/features/assistant/index.ts";
import type { PromptSnippets } from "@/features/snippets/index.ts";
import { useT } from "@/i18n/context";
import { ActionButton } from "@/shared/feedback/index.ts";
import type { T } from "../../i18n/index.ts";
import { usd } from "../costs/index.ts";
import { openTool } from "./domain/session-activity.ts";
import type { SessionState } from "./domain/session-state.ts";
import { Message, RecapSlot, SessionHeader, SessionPane, Timeline } from "./parts";
import { RuntimeBadge } from "./runtime-badge";
import type { SessionActions } from "./session-actions.ts";
import { SessionComposer } from "./session-composer.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { TimelineItem } from "./timeline-item.tsx";
import { useConversationScroll } from "./use-conversation-scroll.ts";
import { useEndSession } from "./use-end-session.tsx";
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

/** Chat history in streaming, tool calls, approval cards, message box and session controls. */
export function SessionView(props: Readonly<SessionViewProps>) {
  const ctx = useT();
  const t = props.t ?? ctx;
  const { focusRequestId } = props;
  const { timeline, away, missed, handlers, jumpToEnd } = useConversationScroll({
    session: props.session,
    focusRequestId,
    scrollKey: props.scrollKey,
  });
  const jumpKey = missed === 1 ? "session.jumpLatestOne" : "session.jumpLatestMany";
  const { session, actions } = props;
  const endSession = useEndSession({
    actions,
    t,
    uncommitted: props.uncommitted,
    onCommitFirst: props.onCommitFirst,
  });
  const opencode = props.runtime === "opencode";
  const fork = opencode ? undefined : props.fork;
  const latestAssistant = [...session.items]
    .reverse()
    .find((item) => item.kind === "assistant")?.seq;
  const closed = session.status === "ended" || session.status === "error";

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
                pending={endSession.ending}
                onClick={endSession.press}
              >
                {t("session.end")}
              </ActionButton>
            )}
          </>
        }
        dialogs={endSession.dialogs}
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
      <SessionComposer
        title={props.title}
        session={session}
        actions={actions}
        t={t}
        scrollKey={props.scrollKey}
        composerFill={props.composerFill}
        onComposerFilled={props.onComposerFilled}
        prompts={props.prompts}
        images={props.images}
        settings={props.settings}
        bypass={props.bypass}
        cache={props.cache}
        pickPath={props.pickPath}
        assist={props.assist}
        runtime={props.runtime}
        effort={props.effort}
        models={props.models}
        onOpenHostSettings={props.onOpenHostSettings}
      />
    </SessionPane>
  );
}
