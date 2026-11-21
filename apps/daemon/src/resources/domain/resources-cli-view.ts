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
  const used = bytes.totalBytes - bytes.freeBytes;
  const share = bytes.totalBytes > 0 ? Math.round((used / bytes.totalBytes) * 100) : 0;
  return `${label}  ${mib(used)} of ${mib(bytes.totalBytes)} MiB used (${share}%)`;
}

const rowLine = (row: ResourceRow): string =>
  [
    row.kind,
    row.id,
    row.name ?? "-",
    `${mib(row.rssBytes)} MiB`,
    `cpu ${row.cpuPercent === null ? "-" : `${row.cpuPercent}%`}`,
    `${row.processes} processes`,
    row.names.join(", "),
  ]
    .filter((field) => field !== "")
    .join("  ");

/** The two numbers `resources end-orphan` takes are the pid and the start ticks. */
const orphanLine = (orphan: ResourceOrphan): string =>
  `orphan  pid ${orphan.pid}  start-ticks ${orphan.startTicks}  ${orphan.name}  ${mib(orphan.rssBytes)} MiB  age ${orphan.ageSec}s`;

/** The guard that holds new cards when memory runs short: its share, and whether it holds now. */
function pauseLine(snapshot: ResourcesSnapshot): string {
  if (snapshot.memoryPauseAt === null || snapshot.memoryPauseAt === undefined) return "pause  off";
  const share = `pause  new cards wait from ${Math.round(snapshot.memoryPauseAt * 100)}% of memory`;
  return snapshot.memoryHolding === true ? `${share}  (holding now)` : share;
}

export const resourcesLines = (snapshot: ResourcesSnapshot): string[] => [
  usage("memory", snapshot.memory),
  usage("disk", snapshot.disk),
  `load  ${snapshot.loadPercent === null ? "not read" : `${snapshot.loadPercent}%`}`,
  pauseLine(snapshot),
  ...(snapshot.measured
    ? [...snapshot.rows.map(rowLine), ...snapshot.orphans.map(orphanLine)]
    : ["processes not measured on this platform"]),
];
