/**
 * The tray's public entry in the app (#1589, #1596): the badge, the "needs you" submenu and the
 * window title that follow the state, and the answers given from the submenu. Another domain
 * imports from here, never a file inside.
 */
export { TraySlice } from "./store.ts";
export { wireTray } from "./wire.ts";
