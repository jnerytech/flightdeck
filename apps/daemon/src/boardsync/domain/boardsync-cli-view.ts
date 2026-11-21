/**
 * Issue #3540: what `flightdeckd boardsync` prints, as pure rules over the daemon's answers. A `--json`
 * value keeps every key: `null` where the daemon sends none (a project with no board carries only `linked`).
 */
import type { BoardSyncBoard, BoardSyncLogEntry, BoardSyncStatus } from "@flightdeck/protocol";

/** One line a board: the id a later `boardsync link` takes, who owns it, its number, its title and its link. */
export const boardLines = (boards: BoardSyncBoard[]): string[] =>
  boards.length === 0
    ? ["no boards"]
    : boards.map((b) => `${b.id}  ${b.owner} #${b.number}  ${b.title}  ${b.url}`);

/** The status as the protocol returns it, with every field it leaves out as `null`. */
export const statusJson = (status: BoardSyncStatus) => ({
  linked: status.linked,
  provider: status.provider ?? null,
  boardId: status.boardId ?? null,
  boardTitle: status.boardTitle ?? null,
  columnMap: status.columnMap ?? null,
  push: status.push ?? null,
  lastSyncedAt: status.lastSyncedAt ?? null,
  lastError: status.lastError ?? null,
  pausedUntil: status.pausedUntil ?? null,
  truncated: status.truncated ?? null,
  statusOptions: status.statusOptions ?? null,
});

export function statusLines(project: string, status: BoardSyncStatus): string[] {
  if (!status.linked) return [`${project}: not linked to a board`];
  const lines = [
    `${project}: linked to ${status.boardTitle ?? "a board"} (${status.provider ?? "unknown provider"}, ${status.boardId ?? "no id"})`,
    `  push: ${status.push ? "on" : "off"}`,
    `  last sync: ${status.lastSyncedAt ?? "never"}`,
  ];
  if (status.pausedUntil) lines.push(`  paused until: ${status.pausedUntil}`);
  if (status.lastError) lines.push(`  last error: ${status.lastError}`);
  if (status.truncated) lines.push("  the board has more items than one pull reads");
  const map = Object.entries(status.columnMap ?? {});
  if (map.length > 0)
    lines.push(`  map: ${map.map(([from, to]) => `${from} -> ${to}`).join(", ")}`);
  if (status.statusOptions && status.statusOptions.length > 0)
    lines.push(`  statuses: ${status.statusOptions.join(", ")}`);
  return lines;
}

/** One entry: when, what kind, then only the parts it has (who won, what was kept, what was lost, the detail). */
function entryLine(entry: BoardSyncLogEntry): string {
  const kept = entry.keptValue === null ? [] : [`kept ${entry.keptValue}${at(entry.keptAt)}`];
  const lost = entry.lostValue === null ? [] : [`lost ${entry.lostValue}${at(entry.lostAt)}`];
  const parts = [...(entry.winner ? [`${entry.winner} won`] : []), ...kept, ...lost];
  const tail = [parts.join(", "), entry.detail ?? ""].filter((part) => part !== "").join("; ");
  return tail === "" ? `${entry.at}  ${entry.kind}` : `${entry.at}  ${entry.kind}: ${tail}`;
}

const at = (when: string | null): string => (when === null ? "" : ` (${when})`);

/** The card's sync log, in the order the daemon gives (oldest first). */
export const logLines = (card: string, entries: BoardSyncLogEntry[]): string[] =>
  entries.length === 0 ? [`${card}: no sync log`] : entries.map(entryLine);
