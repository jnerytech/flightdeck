/**
 * The activity domain's public entry (#1589): how many of a host's latest events a reader gets when
 * it names no limit. Other domains import only from here. `main.ts` builds the domain from
 * `wiring.ts`, which stays out of this entry: its type import of `server/index.ts` would make a
 * cycle for dependency-cruiser.
 */
export { DEFAULT_ACTIVITY_LIMIT } from "./since.ts";
