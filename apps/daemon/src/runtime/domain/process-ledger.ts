export interface LedgerEntry {
  pid: number;
  startTicks: number;
  cmdline: string;
  /** The boot it was written in: after a reboot the start ticks begin again at zero. */
  bootId: string;
}

/**
 * The fields of /proc/<pid>/stat that matter. The command is in parentheses and may hold spaces
 * and parentheses of its own, so the fields are counted from the last `)`: group is the 3rd after
 * it, the start time the 20th.
 */
export function parseStat(text: string): { pgrp: number; startTicks: number } | null {
  const rest = text.slice(text.lastIndexOf(")") + 1).trim();
  if (!rest || !text.includes(")")) return null;
  const fields = rest.split(/\s+/);
  const pgrp = Number(fields[2]);
  const startTicks = Number(fields[19]);
  return Number.isInteger(pgrp) && Number.isInteger(startTicks) ? { pgrp, startTicks } : null;
}

/**
 * Only what `add` writes: a group id above 1 (0 is the caller's own group, 1 or below reaches
 * every process in `kill(-pid)`), a start that is a tick count, and the boot. The file is the
 * user's to edit, so anything else is dropped unread.
 */
export const isEntry = (value: unknown): value is LedgerEntry => {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(e.pid) &&
    (e.pid as number) > 1 &&
    Number.isSafeInteger(e.startTicks) &&
    (e.startTicks as number) >= 0 &&
    typeof e.cmdline === "string" &&
    typeof e.bootId === "string" &&
    e.bootId !== ""
  );
};
