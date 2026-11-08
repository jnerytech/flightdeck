import type { RiskLevel } from "@flightdeck/protocol";
import { Check, Undo2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { ApprovalActions } from "@/components/approval/approval-actions";
import { RiskSeal } from "@/components/approval/approval-card";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { formatTime } from "../../i18n/format.ts";
import type { T } from "../../i18n/index.ts";
import { type InboxEntry, type InboxRow, inboxRows } from "../../lib/inbox.ts";

/** The count on the bell: the unread rows, the same ones that show a dot. */
export function UnreadBadge(props: Readonly<{ unread: number }>) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-status-needs-you px-1 text-[10px] text-background leading-4"
    >
      {props.unread > 99 ? "99+" : props.unread}
    </span>
  );
}

/** A row that is a request still waiting: what its risk is, and whether an answer is on its way. */
export interface RowRequest {
  risk: RiskLevel | undefined;
  reason?: string;
  pending: boolean;
}

/** One row: the dot and the title (bold) when unread, what it is about, and what a click does. */
function InboxItem(
  props: Readonly<{
    row: InboxRow;
    gone: boolean;
    /** Set when the row is a request that can be answered here (Approve, Deny, A and N). */
    request: RowRequest | null;
    t: T;
    onPick(row: InboxRow): void;
    onApprove(row: InboxRow, held: boolean): void;
    onDeny(row: InboxRow): void;
    onMarkRead(row: InboxRow): void;
    onMarkUnread(row: InboxRow): void;
    onDismiss(row: InboxRow): void;
  }>,
) {
  const { row, t, gone } = props;
  const { entry } = row;
  const unread = !entry.read;
  const { request } = props;
  const keysId = useId();
  // The same keys as in Needs you: only a plain press answers, and a high-risk request is never
  // approved by a key (it takes holding the button).
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!request || request.pending || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "a" && request.risk !== "high") props.onApprove(row, false);
    else if (key === "n") props.onDeny(row);
  };
  const says = entry.ask ? `${entry.host ?? ""} · ${entry.ask}`.replace(/^ · /, "") : entry.body;
  return (
    <li className="inbox-item group" data-entry={entry.id}>
      <button
        type="button"
        className="inbox-pick"
        aria-describedby={request ? keysId : undefined}
        onClick={() => props.onPick(row)}
        onKeyDown={onKeyDown}
      >
        <span className="inbox-line">
          {unread && (
            <>
              <span data-slot="unread-dot" aria-hidden="true" className="unread-dot" />
              <span className="sr-only">{t("inbox.unread")}</span>
            </>
          )}
          <span data-slot="row-title" className={unread ? "font-semibold text-sm" : "text-sm"}>
            {entry.subject ?? entry.title}
          </span>
          {row.count > 1 && (
            <span className="text-muted-foreground text-xs">
              {t("inbox.count", { n: row.count })}
            </span>
          )}
          <span className="inbox-time">{formatTime(entry.at, t.lang)}</span>
        </span>
        <span className="text-muted-foreground text-xs">{says}</span>
        {gone && <span className="text-muted-foreground text-xs">{t("inbox.gone")}</span>}
      </button>
      {request && (
        <div className="inbox-request">
          <span id={keysId} className="sr-only">
            {t(request.risk === "high" ? "inbox.keysHigh" : "inbox.keys")}
          </span>
          {request.risk && <RiskSeal risk={request.risk} t={t} {...reason(request)} />}
          <ApprovalActions
            risk={request.risk}
            pending={request.pending}
            size="sm"
            onApprove={(held) => props.onApprove(row, held)}
            onDeny={() => props.onDeny(row)}
          />
        </div>
      )}
      {unread && (
        <span className="inbox-mark">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("inbox.markRead")}
            onClick={() => props.onMarkRead(row)}
          >
            <Check aria-hidden="true" />
          </Button>
        </span>
      )}
      {!unread && !gone && (
        <span className="inbox-mark">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("inbox.markUnread")}
            onClick={() => props.onMarkUnread(row)}
          >
            <Undo2 aria-hidden="true" />
          </Button>
        </span>
      )}
      {gone && (
        <Button
          variant="outline"
          size="sm"
          className="inbox-dismiss"
          onClick={() => props.onDismiss(row)}
        >
          {t("inbox.dismiss")}
        </Button>
      )}
    </li>
  );
}

const reason = (request: RowRequest) => (request.reason ? { reason: request.reason } : {});

/** The panel under the bell: unread first, Today then Earlier, a session's repeats as one row. */
export function NotificationCenter(
  props: Readonly<{
    entries: InboxEntry[];
    /** How many entries are unread, for Mark all as read. */
    unread: number;
    t: T;
    /** Whether what an entry is about no longer exists. */
    gone(entry: InboxEntry): boolean;
    /** What the row is when it is a request that can be answered here, else null. */
    request(entry: InboxEntry): RowRequest | null;
    onPick(row: InboxRow): void;
    onApprove(row: InboxRow, held: boolean): void;
    onDeny(row: InboxRow): void;
    onMarkRead(row: InboxRow): void;
    onMarkUnread(row: InboxRow): void;
    onDismiss(row: InboxRow): void;
    onMarkAll(): void;
    onClear(): void;
  }>,
) {
  const { t, unread } = props;
  const groups = inboxRows(props.entries, new Date());
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** The row being answered: when it leaves, the focus goes to the row now in its place. */
  const answering = useRef<{ id: string; at: number } | null>(null);
  const answer = (row: InboxRow, run: () => void) => {
    const rows = [...(list.current?.querySelectorAll("li[data-entry]") ?? [])];
    const at = rows.findIndex((li) => li.getAttribute("data-entry") === row.entry.id);
    answering.current = { id: row.entry.id, at: Math.max(at, 0) };
    run();
  };
  useEffect(() => {
    const waiting = answering.current;
    if (!waiting) return;
    const still = [...(list.current?.querySelectorAll("li[data-entry]") ?? [])].some(
      (li) => li.getAttribute("data-entry") === waiting.id,
    );
    if (still) return;
    answering.current = null;
    const picks = [...(list.current?.querySelectorAll<HTMLElement>(".inbox-pick") ?? [])];
    (picks[Math.min(waiting.at, picks.length - 1)] ?? heading.current)?.focus();
  });
  return (
    <PopoverContent
      align="end"
      aria-labelledby={titleId}
      className="inbox-panel w-[min(26rem,90vw)]"
    >
      <div className="inbox-head">
        <h2 id={titleId} ref={heading} tabIndex={-1} className="font-semibold text-sm outline-none">
          {t("inbox.title")}
        </h2>
        <div className="inbox-head-actions">
          <Button variant="ghost" size="sm" disabled={unread === 0} onClick={props.onMarkAll}>
            {t("inbox.markAll")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.entries.length === 0}
            onClick={props.onClear}
          >
            {t("inbox.clear")}
          </Button>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">{t("inbox.empty")}</p>
      ) : (
        <div ref={list} className="inbox-groups">
          {groups.map((group) => (
            <section key={group.section} className="inbox-group">
              <h3 className="text-muted-foreground text-xs">
                {t(group.section === "today" ? "inbox.today" : "inbox.earlier")}
              </h3>
              <ul className="inbox-list">
                {group.rows.map((row) => (
                  <InboxItem
                    key={row.entry.id}
                    row={row}
                    gone={props.gone(row.entry)}
                    request={props.request(row.entry)}
                    t={t}
                    onPick={props.onPick}
                    onApprove={(r, held) => answer(r, () => props.onApprove(r, held))}
                    onDeny={(r) => answer(r, () => props.onDeny(r))}
                    onMarkRead={props.onMarkRead}
                    onMarkUnread={props.onMarkUnread}
                    onDismiss={props.onDismiss}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PopoverContent>
  );
}
