import { Bell } from "lucide-react";
import { useState } from "react";
import {
  NotificationCenter,
  type RowRequest,
  UnreadBadge,
} from "@/components/notifications/notification-center";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import type { T } from "../i18n/index.ts";
import { type AppStore, needsYou, sessionKey } from "../lib/app-store.ts";
import {
  describeRequest,
  type InboxEntry,
  type InboxRow,
  inboxTarget,
  unreadCount,
  unreadRows,
} from "../lib/inbox.ts";
import { parseRequestLink } from "../lib/request-link.ts";
import type { Route } from "../lib/router.ts";

/** Requests that are answered in full where they are shown (a question, a plan), never from a row. */
const ASKED_IN_FULL = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** The bell in the top bar: the unread rows and the notification center. */
export function NotificationBell(
  props: Readonly<{
    store: AppStore;
    inbox: InboxEntry[];
    t: T;
    go(route: Route): void;
  }>,
) {
  const { store, t } = props;
  const [open, setOpen] = useState(false);
  /** The requests an answer is on its way for, by `host/request`. */
  const [answering, setAnswering] = useState<ReadonlySet<string>>(new Set());
  const state = store.getState();
  const waiting = needsYou(state, t);
  const itemOf = (entry: InboxEntry) => {
    const request = entry.link ? parseRequestLink(entry.link) : null;
    return request
      ? (waiting.find((i) => i.hostId === request.hostId && i.requestId === request.requestId) ??
          null)
      : null;
  };
  /** A request answered since it was sent leaves the bell (the store says which). */
  const inbox = props.inbox.filter((entry) => {
    const request = entry.link ? parseRequestLink(entry.link) : null;
    return !(request && store.requestAnswered(request.hostId, request.requestId));
  });
  const unread = unreadRows(inbox, new Date());
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
  /** What a row is when it is a request that can be answered here: not a question, a plan, a gate or a secret. */
  const requestOf = (entry: InboxEntry): RowRequest | null => {
    const item = itemOf(entry);
    if (!item || item.gate || item.vault || ASKED_IN_FULL.has(item.toolName)) return null;
    return {
      says: `${item.hostName} · ${describeRequest(item.toolName, item.input, t)}`,
      risk: item.risk,
      ...(item.riskReason ? { reason: item.riskReason } : {}),
      pending: answering.has(`${item.hostId}/${item.requestId}`),
    };
  };
  const respond = async (row: InboxRow, decision: "allow" | "deny", held: boolean) => {
    const item = itemOf(row.entry);
    if (!item) return;
    const key = `${item.hostId}/${item.requestId}`;
    setAnswering((now) => new Set(now).add(key));
    try {
      await store.respondTo(
        item.hostId,
        item.requestId,
        decision,
        decision === "allow" ? { held } : {},
      );
    } finally {
      setAnswering((now) => {
        const next = new Set(now);
        next.delete(key);
        return next;
      });
    }
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
        request={requestOf}
        onPick={pick}
        onApprove={(row, held) => void respond(row, "allow", held)}
        onDeny={(row) => void respond(row, "deny", false)}
        onMarkRead={(row) => store.inboxMarkRead(row.ids)}
        onMarkUnread={(row) => store.inboxMarkUnread(row.ids)}
        onDismiss={(row) => store.inboxDismiss(row.ids)}
        onMarkAll={() => store.inboxMarkAllRead()}
        onClear={() => store.inboxClear()}
      />
    </Popover>
  );
}
