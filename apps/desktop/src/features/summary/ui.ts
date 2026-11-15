/**
 * The session summary's public entry in the app (#1589): the panel that shows a short summary built
 * from a session's transcript, with no model call. Another domain imports from here, never a file inside.
 * Only components: the state and wiring entry is `index.ts`, which re-exports none (#2451).
 */
export { RecapPanel } from "./recap-panel.tsx";
