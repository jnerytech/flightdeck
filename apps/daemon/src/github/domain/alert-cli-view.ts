/**
 * Issue #3736: what `flightdeckd alert list` says, as pure rules over the daemon's answer. The terminal-control
 * scrub is the runner's (`said`, `json`).
 */
import type { AlertsUnavailable, RepoAlert } from "@flightdeck/protocol";

export interface AlertCliArgs {
  /** The project's id or name. */
  project: string;
  json?: boolean;
}

const WHY: Record<AlertsUnavailable["reason"], string> = {
  gh_missing: "gh is not installed",
  not_signed_in: "gh is not signed in",
  unavailable: "not available for this repository",
  failed: "the read failed",
};

export function alertLines(
  project: string,
  alerts: RepoAlert[],
  unavailable: AlertsUnavailable[],
): string[] {
  const unread = unavailable.map((u) => `  ${u.kind} alerts could not be read: ${WHY[u.reason]}`);
  if (alerts.length === 0)
    return [
      unread.length === 0
        ? `no open alerts in ${project}`
        : `no open alerts in ${project}, but not every source could be read`,
      ...unread,
    ];
  return [
    `${alerts.length} open ${alerts.length === 1 ? "alert" : "alerts"} in ${project}`,
    ...alerts.map((alert) =>
      ["", alert.severity, `${alert.kind}#${alert.number}`, alert.title, alert.location]
        .filter((part) => part !== null)
        .join("  ")
        .replace(/^ +/, "  "),
    ),
    ...unread,
  ];
}

/** The keys a script reads, whatever else the daemon adds. */
export const alertJson = (alerts: RepoAlert[], unavailable: AlertsUnavailable[]) => ({
  alerts: alerts.map(({ id, kind, number, severity, title, location, url, text }) => ({
    id,
    kind,
    number,
    severity,
    title,
    location,
    url,
    text,
  })),
  unavailable: unavailable.map(({ kind, reason }) => ({ kind, reason })),
});
