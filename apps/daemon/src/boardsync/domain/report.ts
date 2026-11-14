/** Phase 38: what one sync of a linked project did (issue #1601: a domain type, read by the loop and the service). */
export interface SyncReport {
  created: number;
  moved: number;
  updated: number;
  conflicts: number;
  /** Items with a status the map does not know. */
  unmapped: number;
  gone: number;
  /** Moves not made because the card is running. */
  skipped: number;
  pushed: number;
  redacted: number;
  truncated: boolean;
  notModified: boolean;
}
