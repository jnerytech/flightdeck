import type { Notice } from "./app-store";

/** How long a toast stays when nobody touches it. */
export const SUCCESS_TOAST_MS = 5000;
export const ERROR_TOAST_MS = 10_000;

/** What a toast offers beside Close, when its refusal has a way out in the app. */
export type NoticeAction = { type: "allow-root"; hostId: string; folder: string };

export function noticeAction(_notice: Notice): NoticeAction | null {
  return null;
}

/** Milliseconds until a toast closes itself; `Infinity` for one that waits to be acted on. */
export function noticeLifetime(_notice: Notice): number {
  return 1;
}
