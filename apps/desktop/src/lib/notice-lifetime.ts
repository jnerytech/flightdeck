import type { Notice } from "./app-store";

/** How long a toast stays when nobody touches it. */
export const SUCCESS_TOAST_MS = 5000;
export const ERROR_TOAST_MS = 10_000;

/** What a toast offers beside Close, when its refusal has a way out in the app. */
export type NoticeAction = { type: "allow-root"; hostId: string; folder: string };

export function noticeAction(notice: Notice): NoticeAction | null {
  const folder = notice.params?.cwd;
  if (notice.reason !== "cwd_outside_roots" || !notice.hostId || typeof folder !== "string") {
    return null;
  }
  return { type: "allow-root", hostId: notice.hostId, folder };
}

/** Milliseconds until a toast closes itself; `Infinity` for one that waits to be acted on. */
export function noticeLifetime(notice: Notice): number {
  // A button needs time to be reached (keyboard, screen reader): as long as an error toast.
  if (notice.kind === "success") return notice.link ? ERROR_TOAST_MS : SUCCESS_TOAST_MS;
  return noticeAction(notice) ? Number.POSITIVE_INFINITY : ERROR_TOAST_MS;
}
