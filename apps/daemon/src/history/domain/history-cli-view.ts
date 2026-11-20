/**
 * Issue #3461: what `flightdeckd history list|search|get|tool` say, as pure rules over the daemon's
 * answers. The daemon calls and the exit codes stay in `history/history-cli.ts`.
 */
import type {
  HistoryMessage,
  HistorySearchHit,
  HistorySessionSummary,
  HistoryToolDetail,
} from "@flightdeck/protocol";

export interface HistoryCliArgs {
  action: "list" | "search" | "get" | "tool";
  query?: string;
  claudeSessionId?: string;
  uuid?: string;
  index?: number;
  cwd?: string;
  projectKey?: string;
  from?: string;
  to?: string;
  origin?: "flightdeck" | "external";
  hideAutomated?: boolean;
  limit?: number;
  cursor?: string;
  tail?: boolean;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

/** One session of `history list`. */
export function summaryLine(_session: HistorySessionSummary): string {
  return "";
}

/** One hit of `history search`. */
export function hitLine(_hit: HistorySearchHit): string {
  return "";
}

/** The lines of one message of `history get`: the first holds who and when, the text follows. */
export function messageLines(_message: HistoryMessage): string[] {
  return [];
}

/** The lines of `history tool`. */
export function toolLines(_tool: HistoryToolDetail): string[] {
  return [];
}
