import type { SnapshotInfo } from "@flightdeck/protocol";

/** One turn of the timeline: a `before` snapshot and, once it ended, the `after` one. */
export interface Turn {
  /** The `before` snapshot's n: what the daemon's commands call the turn. */
  n: number;
  /** 1, 2, 3… in the order they ran. */
  ordinal: number;
  prompt: string | null;
  createdAt: string;
  /** The user message's uuid in the transcript, when it is known. */
  uuid: string | null;
  /** Whether its files changed; `running` for the last turn without an end, `unknown` for any other. */
  files: "changed" | "unchanged" | "running" | "unknown";
}

/** The turns of a session, oldest first (the safety snapshots of a rewind are not turns). */
export function turnsOf(snapshots: SnapshotInfo[]): Turn[] {
  const rows = snapshots.filter((s) => s.kind !== "safety");
  return rows
    .map((row, index) => ({ row, next: rows[index + 1] }))
    .filter(({ row }) => row.kind === "before")
    .map(({ row, next }, index) => ({
      n: row.n,
      ordinal: index + 1,
      prompt: row.prompt,
      createdAt: row.createdAt,
      uuid: row.turnUuid,
      files: filesState(row, next),
    }));
}

function filesState(row: SnapshotInfo, next: SnapshotInfo | undefined): Turn["files"] {
  if (next?.kind === "after") return next.tree === row.tree ? "unchanged" : "changed";
  return next === undefined ? "running" : "unknown";
}
