/**
 * The logs domain's public entry (#1589): the daemon's redacted, rotated log and what a connection
 * may read of it. Other domains import only from here, except `server-options.ts`, which takes the
 * `FileLog` type from `file-log.ts`: this entry loads `wiring.ts`, whose type import of
 * `server/index.ts` reaches `server-options.ts` back, a cycle for dependency-cruiser.
 */
export { logPathFor, tailForOrigin } from "./serve.ts";
export { createHostLog } from "./wiring.ts";
