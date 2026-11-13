/**
 * Moves a session with its work to another host, public entry (#1589): another domain imports from
 * here, never a file inside. Only components, so this is the components' entry (ui.ts, #2451) and
 * there is no index.ts.
 */
export { TeleportMove } from "./teleport-move.tsx";
