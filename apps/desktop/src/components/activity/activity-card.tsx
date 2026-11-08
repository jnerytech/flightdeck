import { HoldButton } from "@/components/approval/hold-button";
import { ActionButton } from "@/components/feedback/action-button";
import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { cn } from "@/lib/utils";
import { formatAgo } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { ActivityCard, ActivityColumn } from "../../lib/activity.ts";
import type { PendingItem } from "../../lib/app-store.ts";
import { HIGH_RISK_HOLD_MS } from "../../lib/hold.ts";
import { sessionLineText } from "../../lib/hub.ts";
import { pendingText } from "../../lib/pending-text.ts";

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
  }>,
) {
  const { card, t } = props;
  const { row, pending } = card;
  const line = sessionLineText(row.summary, props.nowMs, t);
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
      </p>
      {line && <p className="activity-card-line">{line}</p>}
      {pending && (
        <div className="activity-card-request">
          <p className="activity-card-ask">{pendingText(pending, t)}</p>
          <p className="activity-card-meta">
            {pending.risk && <span>{t(`approval.risk.${pending.risk}` as Key)}</span>}
            {pending.cwd && <span>{pending.cwd}</span>}
          </p>
          <div className="activity-card-actions">
            {pending.risk === "high" ? (
              <HoldButton
                label={t("approval.hold")}
                hint={t("approval.holdHint")}
                holdMs={props.holdMs ?? HIGH_RISK_HOLD_MS}
                onHeld={() => void props.onRespond(pending, "allow", true)}
              />
            ) : (
              <ActionButton size="sm" onClick={() => props.onRespond(pending, "allow")}>
                {t("activityBoard.approve")}
              </ActionButton>
            )}
            <ActionButton
              size="sm"
              variant="outline"
              onClick={() => props.onRespond(pending, "deny")}
            >
              {t("activityBoard.deny")}
            </ActionButton>
          </div>
        </div>
      )}
    </li>
  );
}
