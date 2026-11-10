/**
 * The store's public entry (#1589): the daemon's SQLite event store. Another domain imports from
 * here, never a file inside.
 */
export { EventStore } from "./event-store.ts";
