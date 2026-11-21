/**
 * Issue #3734: what `flightdeckd bg list` prints, as pure rules over the daemon's answer. The text is one line
 * for each background session: its id, its state, what it waits for, its name (its folder when it has none) and
 * what it cost. `--json` keeps every field of a session, and `null` where the daemon has none.
 */
import type { BgList, BgSession } from "@flightdeck/protocol";

/** The sessions as a script reads them: the fields of the protocol, so a new one on the daemon never leaks in. */
export const bgJson = (list: BgList) => ({
  supported: list.supported,
  sessions: list.sessions.map(
    ({ id, name, cwd, state, status, waitingFor, pid, claudeSessionId, startedAt, costUsd }) => ({
      id,
      name,
      cwd,
      state,
      status,
      waitingFor,
      pid,
      claudeSessionId,
      startedAt,
      costUsd,
    }),
  ),
});

function sessionLine(session: BgSession): string {
  const status = session.status === null ? "" : ` (${session.status})`;
  const waiting = session.waitingFor === null ? "" : `, waiting for ${session.waitingFor}`;
  const cost = session.costUsd === null ? "" : ` $${session.costUsd.toFixed(2)}`;
  return `  ${session.id} ${session.state}${status}${waiting} ${session.name ?? session.cwd}${cost}`;
}

/** A head line with the count, then a line for each session; a host that cannot run them says so. */
export function bgLines(list: BgList): string[] {
  if (!list.supported) return ["this host's claude has no background sessions"];
  if (list.sessions.length === 0) return ["no background sessions"];
  const count = list.sessions.length;
  return [
    `${count} background ${count === 1 ? "session" : "sessions"}`,
    ...list.sessions.map(sessionLine),
  ];
}

/** The one line a write verb prints once the daemon has done it; `start` names the session it made. */
export function bgDoneLine(action: "start" | "stop" | "respawn" | "message", id: string): string {
  if (action === "start") return `started background session ${id}`;
  if (action === "message") return `sent a message to ${id}`;
  return `${action === "stop" ? "stopped" : "respawned"} ${id}`;
}
