import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { formatDay, formatTime } from "../../i18n/format.ts";
import type { T } from "../../i18n/index.ts";
import { groupByDay, type InboxDay, type InboxEntry } from "../../lib/inbox.ts";

function dayLabel(day: InboxDay, t: T): string {
  if (day === "today") return t("inbox.today");
  if (day === "yesterday") return t("inbox.yesterday");
  return formatDay(day, t.lang);
}

/** The count on the bell. */
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

/** The panel under the bell: past notifications, newest first, grouped by day. */
export function NotificationCenter(
  props: Readonly<{
    entries: InboxEntry[];
    unread: number;
    t: T;
    onPick(entry: InboxEntry): void;
    onMarkAll(): void;
    onClear(): void;
  }>,
) {
  const { t, unread } = props;
  const groups = groupByDay(props.entries, new Date());
  return (
    <PopoverContent align="end" className="flex max-h-[28rem] w-96 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm">{t("inbox.title")}</h2>
        <div className="flex gap-1">
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
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.day} className="flex flex-col gap-1">
              <h3 className="text-muted-foreground text-xs">{dayLabel(group.day, t)}</h3>
              <ul className="flex flex-col">
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                      onClick={() => props.onPick(entry)}
                    >
                      <span className="flex w-full items-baseline justify-between gap-2">
                        <span className={entry.read ? "text-sm" : "font-semibold text-sm"}>
                          {entry.title}
                        </span>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {formatTime(entry.at, t.lang)}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">{entry.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PopoverContent>
  );
}
