import { Bell } from "lucide-react";
import { useState } from "react";
import { NotificationCenter, UnreadBadge } from "@/components/notifications/notification-center";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import type { T } from "../i18n/index.ts";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { type InboxEntry, inboxTarget, unreadCount } from "../lib/inbox.ts";
import type { Route } from "../lib/router.ts";

/** The bell in the top bar: the unread count and the notification center. */
export function NotificationBell(props: {
  store: AppStore;
  inbox: InboxEntry[];
  t: T;
  go(route: Route): void;
}) {
  const { store, inbox, t } = props;
  const [open, setOpen] = useState(false);
  const unread = unreadCount(inbox);
  const pick = (entry: InboxEntry) => {
    store.inboxMarkRead(entry.id);
    setOpen(false);
    const { cards } = store.getState();
    const target = inboxTarget(entry, (r) => sessionKey(r.host, r.cardId) in cards);
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
        unread={unread}
        t={t}
        onPick={pick}
        onMarkAll={() => store.inboxMarkAllRead()}
        onClear={() => store.inboxClear()}
      />
    </Popover>
  );
}
