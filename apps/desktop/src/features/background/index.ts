/**
 * The background sessions' public entry in the app (#1589, #1596): Claude Code's own background
 * sessions of each host (list, stop, respawn, message, attach and start). Another domain imports
 * from here, never a file inside.
 */
export {
  type BackgroundCore,
  BackgroundSlice,
  type BackgroundSliceState,
  initialBackgroundState,
} from "./store.ts";
