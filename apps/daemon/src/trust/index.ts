/**
 * The trust domain's public entry (#1589): whether a folder holds many projects, so trusting it as a
 * root trusts them all. Other domains import only from here. `main.ts` builds the domain from
 * `wiring.ts`, which stays out of this entry: its import of `server/index.ts` would make a cycle.
 */
export { trustsManyProjects } from "./trust-root.ts";
