/**
 * Issue #3756: what `flightdeckd db status` says, as pure rules over the maintenance status. The command runs on
 * the machine it is typed on, so there is nothing to scrub: every field is a number, a time or a path of this host.
 */
import type { MaintenanceStatus } from "@flightdeck/protocol";

const sizeOf = (bytes: number) => `${bytes} bytes`;

/** One line per fact; the backups newest first, as the status keeps them, and the last cleanup's count per table. */
export function statusLines(status: MaintenanceStatus): string[] {
  const { counts, lastBackup, lastPrune } = status;
  const lines = [
    `database: ${sizeOf(status.dbBytes)}`,
    `sessions: ${counts.sessions}, events: ${counts.events}, external sessions: ${counts.externalSessions}`,
    lastBackup ? `last backup: ${lastBackup.at}, ${sizeOf(lastBackup.bytes)}` : "last backup: none",
    `backups kept: ${status.backups.length}`,
    ...status.backups.map((b) => `  ${b.at}  ${sizeOf(b.bytes)}  ${b.path}`),
  ];
  if (!lastPrune) return [...lines, "last cleanup: none"];
  const how = lastPrune.dryRun ? "dry run (nothing was deleted)" : "done";
  return [
    ...lines,
    `last cleanup: ${lastPrune.at}, ${how}`,
    ...Object.entries(lastPrune.counts).map(([table, n]) => `  ${table}: ${n}`),
  ];
}
