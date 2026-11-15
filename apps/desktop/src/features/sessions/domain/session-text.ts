import { translateError } from "../../../i18n/errors.ts";
import type { T } from "../../../i18n/index.ts";
import type { Activity } from "./session-activity.ts";
import type { ChatItem } from "./session-state.ts";

/** The words for what the session is doing, from the dictionary. */
export function activityText(activity: Activity, t: T): string {
  if (activity.kind === "tool") return t(`activity.${activity.group}`, { tool: activity.tool });
  return t(`activity.${activity.kind}`);
}

/** Phase 39: a session error, as the app's own sentence when it carries a reason the app knows. */
export function errorText(item: Extract<ChatItem, { kind: "error" }>, t: T): string {
  const { title, detail } = translateError(item.code, item.message, t, item);
  return item.reason && !detail ? title : `${item.code}: ${item.message}`;
}

/** "12s", "1m 5s": how long the turn has been running. */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}
