import type { PendingPermission, SessionStatus } from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";
import type { Notification } from "../platform/types.ts";
import type { InboxAbout } from "./inbox.ts";

/** A notification, with what it is about for the notification center. */
export type AboutNotification = Notification & { about?: InboxAbout };

export interface SummarySnapshot {
  status: SessionStatus;
  pendingPermissions: PendingPermission[];
}

const IN_TURN: ReadonlySet<SessionStatus> = new Set(["starting", "running", "awaiting_permission"]);

/**
 * Notifications for the change between two summaries of the same session: each new permission
 * request and the end of a turn. Nothing for the first summary seen or while the window has focus.
 */
export function summaryNotifications(
  prev: SummarySnapshot | undefined,
  next: SummarySnapshot,
  label: string,
  focused: boolean,
  /** The `flightdeck://` link of a request, opened by a click on its notification (phase 8). */
  linkFor?: (requestId: string) => string,
  t: T = translator("pt-BR"),
  _names?: { subject: string; host: string; group: string },
): AboutNotification[] {
  if (focused || !prev) return [];
  const known = new Set(prev.pendingPermissions.map((p) => p.requestId));
  const notifications: AboutNotification[] = next.pendingPermissions
    .filter((p) => !known.has(p.requestId))
    .map((p) => ({
      title: t("notify.waiting", { label }),
      body: t("notify.allow", { tool: p.toolName }),
      ...(linkFor ? { link: linkFor(p.requestId) } : {}),
    }));
  if (IN_TURN.has(prev.status) && next.status === "idle") {
    notifications.push({ title: t("notify.turnDone", { label }), body: t("notify.turnDoneBody") });
  }
  return notifications;
}

/** The notification of a terminal session's permission request, with what the panel needs to name it. */
export function externalRequestNotification(
  _args: {
    hostId: string;
    hostName: string;
    subject: string;
    claudeSessionId: string;
    toolName: string;
    input: Record<string, unknown> | undefined;
    link: string;
  },
  _t: T,
): AboutNotification {
  return { title: "", body: "" };
}
