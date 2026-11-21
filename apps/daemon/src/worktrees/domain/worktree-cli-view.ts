/** Issue #3702: what `flightdeckd worktree list` says, as lines. Paths and names come from disk and the board: the printer cleans them. */
import type { WorktreeItem, WorktreesResult } from "@flightdeck/protocol";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A size as the app shows it: 1024-based, one decimal from the KB up. */
function sizeText(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** A worktree on one line: where it is, what it belongs to, its state, its size, its idle time and why it is kept or offered. */
function worktreeLine(item: WorktreeItem): string {
  const parts = [
    item.path,
    item.projectName,
    item.branch ?? "no branch",
    item.cardId === null ? "no card" : `card ${item.cardId}`,
    `${item.dirty ? "dirty" : "clean"}, ${item.unpushed} unpushed`,
    // A scan that did not finish is `null`: never shown as a size of 0.
    item.sizeBytes === null ? "size unknown" : sizeText(item.sizeBytes),
    `idle ${Math.floor(item.idleDays)} d`,
  ];
  if (item.blockers.length > 0) parts.push(`blocked: ${item.blockers.join(", ")}`);
  if (item.suggested) parts.push("suggested");
  return parts.join("  ");
}

/** The worktrees, then the free disk of each project that has one. */
export function worktreeLines(result: WorktreesResult): string[] {
  const names = new Map(result.worktrees.map((item) => [item.projectId, item.projectName]));
  return [
    ...(result.worktrees.length === 0 ? ["no worktrees"] : result.worktrees.map(worktreeLine)),
    ...result.disks.map(
      (disk) =>
        `disk ${names.get(disk.projectId) ?? disk.projectId}: ${sizeText(disk.freeBytes)} free of ${sizeText(disk.totalBytes)}`,
    ),
  ];
}
