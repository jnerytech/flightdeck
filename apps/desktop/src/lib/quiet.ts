import { formatDuration } from "../i18n/format.ts";
import type { T } from "../i18n/index.ts";
import { type AppState, sessionKey } from "./app-store.ts";
import { type HubRowState, hubRows } from "./hub.ts";

export { QUIET_SNOOZE_MS } from "./app-store.ts";

/** The parts of the state the quiet sessions are made of. */
export type QuietState = HubRowState & Pick<AppState, "quietSnooze">;

/** A running session the host marked quiet, as Needs you lists it. */
export interface QuietAlert {
  /** `host/session`. */
  key: string;
  hostId: string;
  hostName: string;
  sessionId: string;
  title: string;
  /** When it went silent (ISO). */
  since: string;
  tool: string | null;
}

export function quietAlerts(state: QuietState, nowMs: number): QuietAlert[] {
  return hubRows(state)
    .flatMap((row) => {
      if (row.origin !== "flightdeck" || row.state !== "running" || !row.sessionId) return [];
      if (!row.quietSince) return [];
      const key = sessionKey(row.hostId, row.sessionId);
      if ((state.quietSnooze[key] ?? 0) > nowMs) return [];
      return [
        {
          key,
          hostId: row.hostId,
          hostName: row.hostName,
          sessionId: row.sessionId,
          title: row.title,
          since: row.quietSince,
          tool: row.quietTool ?? null,
        },
      ];
    })
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/** "Quiet for 23 min · last: Bash". */
export function quietText(alert: QuietAlert, nowMs: number, t: T): string {
  const quiet = t("needsYou.quietFor", {
    span: formatDuration(Math.max(0, nowMs - Date.parse(alert.since)), t),
  });
  return alert.tool ? t("needsYou.quietLast", { quiet, tool: alert.tool }) : quiet;
}
