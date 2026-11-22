/** Issue #3699: what `flightdeckd resources` prints, as pure functions of the snapshot the daemon answered. */
import type { ResourceOrphan, ResourceRow, ResourcesSnapshot } from "@flightdeck/protocol";

type Bytes = ResourcesSnapshot["memory"];

const MIB = 1024 * 1024;

const mib = (bytes: number): number => Math.round(bytes / MIB);

/** Every key a script reads: what an older host leaves out is `null` or `false`. */
export const resourcesJson = (snapshot: ResourcesSnapshot) => ({
  ...snapshot,
  memoryPauseAt: snapshot.memoryPauseAt ?? null,
  memoryHolding: snapshot.memoryHolding === true,
});

/** `used of total MiB used (share%)`, for memory and disk. */
function usage(label: string, bytes: Bytes | null): string {
  if (bytes === null) return `${label}  not read`;
  const used = Math.min(Math.max(bytes.totalBytes - bytes.freeBytes, 0), bytes.totalBytes);
  const share = bytes.totalBytes > 0 ? Math.round((used / bytes.totalBytes) * 100) : 0;
  return `${label}  ${mib(used)} of ${mib(bytes.totalBytes)} MiB used (${share}%)`;
}

const loadShare = (percent: number | null) => (percent === null ? "not read" : `${percent}%`);

const cpuShare = (percent: number | null) => (percent === null ? "-" : `${percent}%`);

const rowLine = (row: ResourceRow): string =>
  [
    row.kind,
    row.id,
    row.name ?? "-",
    `${mib(row.rssBytes)} MiB`,
    `cpu ${cpuShare(row.cpuPercent)}`,
    `${row.processes} ${row.processes === 1 ? "process" : "processes"}`,
    row.names.join(", "),
  ]
    .filter((field) => field !== "")
    .join("  ");

/** The pid and the start ticks name one orphan: the pair the daemon's `resources.endOrphan` request takes. */
const orphanLine = (orphan: ResourceOrphan): string =>
  `orphan  pid ${orphan.pid}  start-ticks ${orphan.startTicks}  ${orphan.name}  ${mib(orphan.rssBytes)} MiB  age ${orphan.ageSec}s`;

/** The guard that holds new cards when memory runs short: its share, or off. */
export const guardLine = (share: number | null | undefined): string =>
  share === null || share === undefined
    ? "pause  off"
    : `pause  new cards wait from ${Math.round(share * 100)}% of memory`;

/** The guard as the read prints it: its share, and whether it holds now. */
function pauseLine(snapshot: ResourcesSnapshot): string {
  const share = guardLine(snapshot.memoryPauseAt);
  return snapshot.memoryPauseAt != null && snapshot.memoryHolding === true
    ? `${share}  (holding now)`
    : share;
}

/** What the person is told when an orphan was ended: the pid names it. */
export const endedLine = (pid: number): string => `ended  pid ${pid}`;

export const UNSURE_ORPHAN =
  "; the process may or may not have been ended: read `resources` to see if it is still listed";
export const UNSURE_GUARD =
  "; the guard may or may not have changed: read `resources` to see it before trying again";

export const resourcesLines = (snapshot: ResourcesSnapshot): string[] => [
  usage("memory", snapshot.memory),
  usage("disk", snapshot.disk),
  `load  ${loadShare(snapshot.loadPercent)}`,
  pauseLine(snapshot),
  ...(snapshot.measured
    ? [...snapshot.rows.map(rowLine), ...snapshot.orphans.map(orphanLine)]
    : ["processes not measured on this platform"]),
];
