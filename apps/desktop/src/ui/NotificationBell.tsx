import { Bell } from "lucide-react";
import { useState } from "react";
import { NotificationCenter, UnreadBadge } from "@/components/notifications/notification-center";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import type { T } from "../i18n/index.ts";
import { type AppStore, needsYou, sessionKey } from "../lib/app-store.ts";
import {
  type InboxEntry,
  type InboxRow,
  inboxTarget,
  unreadCount,
  unreadRows,
} from "../lib/inbox.ts";
import { parseRequestLink } from "../lib/request-link.ts";
import type { Route } from "../lib/router.ts";

/** The bell in the top bar: the unread rows and the notification center. */
export function NotificationBell(props: {
  store: AppStore;
  inbox: InboxEntry[];
  t: T;
  go(route: Route): void;
}) {
  const { store, inbox, t } = props;
  const [open, setOpen] = useState(false);
  const unread = unreadRows(inbox, new Date());
  const state = store.getState();
  const cardExists = (r: Extract<Route, { name: "card" }>) =>
    sessionKey(r.host, r.cardId) in state.cards;
  /** Whether the request of a link still waits for an answer. */
  const requestOpen = (link: string) => {
    const request = parseRequestLink(link);
    return (
      request !== null &&
      needsYou(state).some((i) => i.hostId === request.hostId && i.requestId === request.requestId)
    );
  };
  /** What an entry is about no longer exists: a card with no pull request to fall back on, or a request already answered. */
  const gone = (entry: InboxEntry) => {
    if (entry.route?.name === "card" && !entry.fallbackUrl) return !cardExists(entry.route);
    return (
      entry.link !== undefined && parseRequestLink(entry.link) !== null && !requestOpen(entry.link)
    );
  };
  const pick = (row: InboxRow) => {
    store.inboxMarkRead(row.ids);
    setOpen(false);
    const target = inboxTarget(row.entry, cardExists, requestOpen);
    if (target?.kind === "link") store.openRequestLink(target.link);
    else if (target?.kind === "url") store.openLink(target.url);
    else if (target?.kind === "route") props.go(target.route);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative ml-auto"
          aria-label={unread > 0 ? t("inbox.bellUnread", { n: unread }) : t("inbox.bell")}
        >
          <Bell />
          {unread > 0 && <UnreadBadge unread={unread} />}
        </Button>
      </PopoverTrigger>
      <NotificationCenter
        entries={inbox}
        unread={unreadCount(inbox)}
        t={t}
        gone={gone}
        onPick={pick}
        onMarkRead={(row) => store.inboxMarkRead(row.ids)}
        onDismiss={(row) => store.inboxDismiss(row.ids)}
        onMarkAll={() => store.inboxMarkAllRead()}
        onClear={() => store.inboxClear()}
      />
    </Popover>
  );
}
