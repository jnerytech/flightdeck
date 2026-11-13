/**
 * The store's public entry (#1589): the daemon's SQLite event store, its schema migrations, and the
 * persona badge a session's summary carries. Another domain imports from here, never a file inside.
 */
export { EventStore, type PermissionStatus, personaBadge } from "./event-store.ts";
export { MIGRATIONS } from "./migrations.ts";
