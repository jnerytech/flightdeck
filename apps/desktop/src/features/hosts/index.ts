/**
 * The hosts' public entry in the app (#1589, #1596): what each host's checks say about its health.
 * Another domain imports from here, never a file inside.
 */
export {
  type HealthAnswer,
  type HealthCore,
  HealthSlice,
  type HealthSliceState,
  initialHealthState,
} from "./health-store.ts";
