/**
 * The teleport domain's public entry (#1589): a session's package sent from one host and imported on
 * another, and the safe git call it runs with. `main.ts` still builds the domain through `wiring.ts`.
 * Another domain imports from here, never a file inside.
 */
export { SAFE, TIMEOUT_MS } from "./git.ts";
export { importPackage, type TeleportImportDeps } from "./import.ts";
export type { TeleportPackages } from "./package.ts";
export type { TeleportInbox } from "./receive.ts";
