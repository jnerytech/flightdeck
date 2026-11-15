import type { ConnectionStatus, Drop } from "../host-connection.ts";

/**
 * The app log's line for a status change: a drop of a link that was online is the one WARN, with
 * why; the tries that follow, and coming back, are INFO.
 */
export function statusLine(
  name: string,
  status: ConnectionStatus,
  drop: Drop | null,
): { level: "info" | "warn"; text: string } {
  if (status !== "offline" || drop === null) {
    const level = status === "online" || status === "connecting" ? "info" : "warn";
    return { level, text: `${name}: ${status}` };
  }
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  const silent = `${seconds(drop.silentMs)} silent`;
  const ping = drop.pingMs === null ? "no ping heard" : `last ping ${seconds(drop.pingMs)} ago`;
  const clocks = `up ${seconds(drop.upMs)}, ${ping}`;
  // 1006 is the browser's own code for a link that ended without a close frame.
  const by = drop.code === 1006 ? "" : " by the host";
  const reason = drop.reason ? ` ${drop.reason}` : "";
  let why = `closed${by} (${drop.code}${reason}), ${silent}, ${clocks}`;
  if (drop.byWatchdog) why = `given up by the app after ${silent}, ${clocks}`;
  else if (drop.byApp) why = `closed by the app, ${silent}, ${clocks}`;
  // A line of the app's own log, not text on a screen: it stays in English, as every log line does.
  const line = `${name}: offline, ${why}`;
  return { level: drop.wasOnline && !drop.byApp ? "warn" : "info", text: line };
}
