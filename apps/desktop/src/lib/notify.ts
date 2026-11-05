import type { PendingPermission, SessionStatus } from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";
import type { Notification } from "../platform/types.ts";
import { describeRequest, type InboxAbout } from "./inbox.ts";

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
  names?: { subject: string; host: string; group: string },
): AboutNotification[] {
  if (focused || !prev) return [];
  const known = new Set(prev.pendingPermissions.map((p) => p.requestId));
  const notifications: AboutNotification[] = next.pendingPermissions
    .filter((p) => !known.has(p.requestId))
    .map((p) => ({
      title: t("notify.waiting", { label }),
      body: t("notify.allow", { tool: p.toolName }),
      ...(linkFor ? { link: linkFor(p.requestId) } : {}),
      ...(names
        ? {
            about: {
              subject: names.subject,
              host: names.host,
              ask: describeRequest(p.toolName, p.input, t),
              group: names.group,
            },
          }
        : {}),
    }));
  if (IN_TURN.has(prev.status) && next.status === "idle") {
    notifications.push({
      title: t("notify.turnDone", { label }),
      body: t("notify.turnDoneBody"),
      ...(names ? { about: { subject: names.subject, host: names.host } } : {}),
    });
  }
  return notifications;
}

/** The notification of a terminal session's permission request, with what the panel needs to name it. */
export function externalRequestNotification(
  args: {
    hostId: string;
    hostName: string;
    subject: string;
    claudeSessionId: string;
    toolName: string;
    input: Record<string, unknown> | undefined;
    link: string;
  },
  t: T,
): AboutNotification {
  return {
    title: t("notify.externalTitle"),
    body: `${args.hostName} · ${args.toolName}`,
    link: args.link,
    about: {
      subject: args.subject,
      host: args.hostName,
      ask: describeRequest(args.toolName, args.input, t),
      group: `${args.hostId}/${args.claudeSessionId}`,
    },
  };
}
