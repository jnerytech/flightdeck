/**
 * The activity's public entry in the app (#1589, #1596): what happened on the hosts while the app
 * was away. Another domain imports from here, never a file inside.
 */
export {
  type ActivityCore,
  ActivitySlice,
  type ActivitySliceState,
  type AwayHost,
  type AwayState,
  initialActivityState,
} from "./store.ts";
