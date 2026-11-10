// The permission modes of a session, shared by the daemon and the app (issue #1600: moved from index.ts).
import { z } from "zod";

export const PermissionMode = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
]);
export type PermissionMode = z.infer<typeof PermissionMode>;
/** The modes a live session can be switched to (never one that skips the questions). */
/** `bypassPermissions` is refused by the daemon unless the host's switch is on. */
export const SettableMode = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);
export type SettableMode = z.infer<typeof SettableMode>;
