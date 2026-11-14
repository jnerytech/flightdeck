/**
 * The notification center's public entry in the app (#1589, #1596): what the app sent, kept for the
 * bell; the taskbar badge, the system toast and the sound. Another domain imports from here, never a
 * file inside. The bell component is in ui.ts (#2451).
 */

export type { InboxEntry } from "./domain/inbox.ts";
export { type InboxCore, InboxSlice } from "./store.ts";
export { wireInbox } from "./wire.ts";
