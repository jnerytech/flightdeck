/**
 * The session summary's public entry in the app (#1589): the panel that shows a short summary built
 * from a session's transcript, with no model call. Another domain imports from here, never a file inside.
 * Only components, so this is the components' entry (ui.ts, #2451) and there is no index.ts.
 */
export { RecapPanel } from "./recap-panel.tsx";
