import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { formatTime } from "../../i18n/format.ts";
import type { T } from "../../i18n/index.ts";
import { type InboxEntry, type InboxRow, inboxRows } from "../../lib/inbox.ts";

/** The count on the bell: the unread rows, the same ones that show a dot. */
export function UnreadBadge(props: { unread: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-status-needs-you px-1 text-[10px] text-background leading-4"
    >
      {props.unread > 99 ? "99+" : props.unread}
    </span>
  );
}

/** One row: the dot and the title (bold) when unread, what it is about, and what a click does. */
function InboxItem(props: {
  row: InboxRow;
  gone: boolean;
  t: T;
  onPick(row: InboxRow): void;
  onMarkRead(row: InboxRow): void;
  onMarkUnread(row: InboxRow): void;
  onDismiss(row: InboxRow): void;
}) {
  const { row, t, gone } = props;
  const { entry } = row;
  const unread = !entry.read;
  const says = entry.ask ? `${entry.host ?? ""} · ${entry.ask}`.replace(/^ · /, "") : entry.body;
  return (
    <li className="inbox-item group">
      <button type="button" className="inbox-pick" onClick={() => props.onPick(row)}>
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

/** The panel under the bell: unread first, Today then Earlier, a session's repeats as one row. */
export function NotificationCenter(props: {
  entries: InboxEntry[];
  /** How many entries are unread, for Mark all as read. */
  unread: number;
  t: T;
  /** Whether what an entry is about no longer exists. */
  gone(entry: InboxEntry): boolean;
  onPick(row: InboxRow): void;
  onMarkRead(row: InboxRow): void;
  onMarkUnread(row: InboxRow): void;
  onDismiss(row: InboxRow): void;
  onMarkAll(): void;
  onClear(): void;
}) {
  const { t, unread } = props;
  const groups = inboxRows(props.entries, new Date());
  return (
    <PopoverContent align="end" className="inbox-panel w-[min(26rem,90vw)]">
      <div className="inbox-head">
        <h2 className="font-semibold text-sm">{t("inbox.title")}</h2>
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
        <div className="inbox-groups">
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
                    t={t}
                    onPick={props.onPick}
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
