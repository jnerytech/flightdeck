import { basename } from "@/shared/lib/index.ts";
import { formatDuration } from "../../../i18n/format.ts";
import type { T } from "../../../i18n/index.ts";
import { type AppState, sessionKey } from "../../../lib/app-store.ts";
import { sessionLabel } from "../../sessions/index.ts";

export { QUIET_SNOOZE_MS } from "./quiet-snooze.ts";

/** The parts of the state the quiet sessions are made of. */
export type QuietState = Pick<AppState, "hosts" | "meta" | "names" | "personas" | "quietSnooze">;

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

/**
 * The quiet sessions of the live summaries (`sessions.watch`), as Needs you reads its requests: the
 * host's session list (the hub) is fetched only when a page asks for it, so it cannot be the source.
 */
export function quietAlerts(state: QuietState, nowMs: number, t?: T): QuietAlert[] {
  return state.hosts
    .flatMap((host) =>
      host.sessions.flatMap((session) => {
        if (session.status !== "running" || !session.quietSince) return [];
        const key = sessionKey(host.id, session.id);
        if ((state.quietSnooze[key] ?? 0) > nowMs) return [];
        const title =
          sessionLabel(
            {
              metaName: state.meta[key]?.name,
              createdName: session.name,
              names: state.names?.[host.id]?.find((n) => n.sessionId === session.id),
              personas: state.personas?.[host.id],
            },
            t,
          ) ?? basename(session.cwd);
        return [
          {
            key,
            hostId: host.id,
            hostName: host.name,
            sessionId: session.id,
            title,
            since: session.quietSince,
            tool: session.quietTool ?? null,
          },
        ];
      }),
    )
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/** "Quiet for 23 min · last: Bash". */
export function quietText(alert: QuietAlert, nowMs: number, t: T): string {
  const quiet = t("needsYou.quietFor", {
    span: formatDuration(Math.max(0, nowMs - Date.parse(alert.since)), t),
  });
  return alert.tool ? t("needsYou.quietLast", { quiet, tool: alert.tool }) : quiet;
}
