import { type MouseEvent, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { pendingText } from "@/features/needs-you/index.ts";
import { HIGH_RISK_HOLD_MS } from "@/features/permissions/index.ts";
import { HoldButton } from "@/features/permissions/ui.ts";
import { sessionLineText } from "@/features/sessions/index.ts";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/shared/feedback/index.ts";
import { type StateTone, StatusDot } from "@/shared/status/index.ts";
import { formatAgo, formatDuration } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { PendingItem } from "../../lib/app-store.ts";
import type { ActivityCard, ActivityColumn } from "./domain/activity.ts";

const TONE: Record<ActivityColumn, StateTone> = {
  needs_you: "needs-you",
  working: "running",
  done: "idle",
  idle: "idle",
};

/** A name the browser accepts for a view transition, from the card's key. */
const transitionName = (key: string) => `activity-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

/**
 * One session on the Activity board: the state glyph, the session (it opens it), where it runs,
 * the last request and what it is doing, how long ago it changed, and, when it is asking, the
 * request with Approve and Deny (a high-risk one is approved by holding the button).
 */
export function ActivityCardView(
  props: Readonly<{
    card: ActivityCard;
    t: T;
    nowMs: number;
    onOpen(newTab: boolean): void;
    /** `held`: the Approve was held its full time, the proof the store asks of a high risk (#245). */
    onRespond(request: PendingItem, decision: "allow" | "deny", held?: boolean): unknown;
    /** Test seam: the hold time of a high-risk approval. */
    holdMs?: number;
    /** Why the last Approve or Deny did not go through, while its request still waits here (#4240). */
    failure?: string;
    /** Hands the title button to the board, which returns the focus to it after an answer (#2675). */
    titleRef?(button: HTMLButtonElement | null): void;
  }>,
) {
  const { card, t } = props;
  const { row, pending } = card;
  const line = sessionLineText(row.summary, props.nowMs, t);
  // The button that sent the answer is disabled while it sends, and a browser drops the focus of a
  // button that becomes disabled. A failed answer gives it back once the button is enabled again (#4240).
  const sent = useRef<HTMLElement | null>(null);
  const rememberSent = (event: MouseEvent) => {
    sent.current = event.target instanceof HTMLElement ? event.target.closest("button") : null;
  };
  useEffect(() => {
    const button = sent.current;
    if (!props.failure || !button?.isConnected) return;
    // Once only: the focus is still on the button, or the person has moved it, or it goes back now.
    if (button instanceof HTMLButtonElement && button.disabled) return;
    sent.current = null;
    if (document.activeElement === document.body) button.focus();
  });
  return (
    <li
      data-slot="activity-card"
      data-column={card.column}
      aria-label={row.title}
      style={{ viewTransitionName: transitionName(row.key) }}
      className={cn("activity-card", `activity-card-${card.column}`)}
    >
      <div className="activity-card-head">
        <StatusDot tone={TONE[card.column]} label={t(`hub.stateDots.${row.state}` as Key)} />
        <button
          ref={props.titleRef}
          type="button"
          className="activity-card-title"
          onClick={(e) => props.onOpen(e.ctrlKey || e.metaKey)}
          onAuxClick={(e) => {
            if (e.button === 1) props.onOpen(true);
          }}
        >
          {row.title}
        </button>
        <span className="activity-card-age">
          {card.changedAt > 0 ? formatAgo(Math.max(0, props.nowMs - card.changedAt), t) : ""}
        </span>
      </div>
      <p className="activity-card-where">
        <span>{card.project}</span>
        <span aria-hidden="true">·</span>
        <span>{row.hostName}</span>
        {row.persona && <span className="activity-card-persona">{row.persona.name}</span>}
        {row.quietSince && (
          <span className="activity-card-quiet">
            {t("activityBoard.quiet", {
              span: formatDuration(Math.max(0, props.nowMs - Date.parse(row.quietSince)), t),
            })}
          </span>
        )}
      </p>
      {line && <p className="activity-card-line">{line}</p>}
      {row.waitingPlan && (
        <p data-slot="activity-card-plan" className="activity-card-plan">
          {row.waitingPlan}
        </p>
      )}
      {card.column === "needs_you" && !pending && (
        /* A gate, a vault request, a plan or a question is answered in the session, not here (#4242). */
        <div className="activity-card-actions">
          <Button
            size="sm"
            variant="outline"
            aria-label={t("activityBoard.openToAnswerFor", { title: row.title })}
            onClick={() => props.onOpen(false)}
          >
            {t("activityBoard.openToAnswer")}
          </Button>
        </div>
      )}
      {pending && (
        <div className="activity-card-request">
          <p className="activity-card-ask">{pendingText(pending, t)}</p>
          <p className="activity-card-meta">
            {pending.risk && <span>{t(`approval.risk.${pending.risk}` as Key)}</span>}
            {pending.cwd && <span>{pending.cwd}</span>}
          </p>
          <div className="activity-card-actions" onClickCapture={rememberSent}>
            {pending.risk === "high" ? (
              <HoldButton
                label={t("approval.hold")}
                name={t("activityBoard.holdFor", { title: row.title })}
                hint={t("approval.holdHint")}
                clickHint={t("approval.holdClick")}
                holdMs={props.holdMs ?? HIGH_RISK_HOLD_MS}
                onHeld={() => void props.onRespond(pending, "allow", true)}
              />
            ) : (
              <ActionButton
                size="sm"
                aria-label={t("activityBoard.approveFor", { title: row.title })}
                onClick={() => props.onRespond(pending, "allow")}
              >
                {t("activityBoard.approve")}
              </ActionButton>
            )}
            <ActionButton
              size="sm"
              variant="outline"
              aria-label={t("activityBoard.denyFor", { title: row.title })}
              onClick={() => props.onRespond(pending, "deny")}
            >
              {t("activityBoard.deny")}
            </ActionButton>
          </div>
          {props.failure && (
            <p role="alert" className="text-destructive text-xs">
              {props.failure}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
