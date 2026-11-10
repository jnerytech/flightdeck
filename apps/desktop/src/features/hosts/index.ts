/**
 * The hosts' public entry in the app (#1589, #1596): what each host's checks say about its health and
 * its daemon's update.
 * Another domain imports from here, never a file inside.
 */
export {
  type HealthAnswer,
  type HealthCore,
  HealthSlice,
  type HealthSliceState,
  initialHealthState,
} from "./health-store.ts";
export {
  type HostUpdateCore,
  type HostUpdatePatch,
  HostUpdateSlice,
  type HostUpdateView,
} from "./update-store.ts";
