/** What `flightdeckd update check|apply` prints (#3780), apart from the runner so the text is plain functions. */
import type { UpdateStatus } from "@flightdeck/protocol";

/** One line: the version found, that there is none, or why the check failed; the time is the daemon's. */
export function updateCheckLine(status: UpdateStatus): string {
  const checked = `checked ${status.checkedAt}`;
  if (status.error !== undefined) return `check failed  ${status.error}  ${checked}`;
  if (status.available) return `available  ${status.version ?? "unknown"}  ${checked}`;
  return `up to date  ${checked}`;
}

/** All four keys, with null for the error a good check does not have. */
export const updateCheckJson = (status: UpdateStatus) => ({
  available: status.available,
  version: status.version,
  checkedAt: status.checkedAt,
  error: status.error ?? null,
});

export const UPDATE_STARTED = "update started";

export const UNSURE_APPLY =
  "; the update may or may not have started: run `update check` and read `host` for the daemon's version before trying again";
