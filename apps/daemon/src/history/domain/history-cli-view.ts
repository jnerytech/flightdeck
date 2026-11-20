/**
 * Issue #3461: what `flightdeckd history list|search|get|tool|resume|watch` say, as pure rules over the daemon's
 * answers. The daemon calls and the exit codes stay in `history/history-cli.ts`.
 */
import type {
  HistoryChanged,
  HistoryMessage,
  HistorySearchHit,
  HistorySessionSummary,
  HistoryToolDetail,
  PermissionMode,
} from "@flightdeck/protocol";

export interface HistoryCliArgs {
  action: "list" | "search" | "get" | "tool" | "resume" | "watch";
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
  /** `resume`: the name of the new session, its permission mode, and the yes for a transcript that may be running. */
  name?: string;
  permissionMode?: PermissionMode;
  force?: boolean;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

const lines = (text: string) => text.split(/\r\n|\r|\n/);

/** One session of `history list`. */
export function summaryLine(session: HistorySessionSummary): string {
  const count = `${session.messageCount} ${session.messageCount === 1 ? "message" : "messages"}`;
  const running = session.maybeActive ? " [may be running]" : "";
  const when = session.lastTs ?? session.firstTs ?? "-";
  return `${session.claudeSessionId}  ${when}  ${session.cwd}  ${session.title ?? "(untitled)"} (${count})${running}`;
}

/** One hit of `history search`. */
export function hitLine(hit: HistorySearchHit): string {
  return `${hit.claudeSessionId}  ${hit.uuid}  ${hit.ts ?? "-"}  ${hit.role}: ${hit.snippet}`;
}

/** The lines of one message of `history get`: the first holds when and who, the text follows indented. */
export function messageLines(message: HistoryMessage): string[] {
  const [first = "", ...rest] = lines(message.text);
  return [
    `${message.ts ?? "-"} ${message.role ?? message.kind}: ${first}`,
    ...rest.map((line) => `  ${line}`),
  ];
}

/** The lines of `history tool`: the call, its input, then its result or the fact that there is none yet. */
export function toolLines(tool: HistoryToolDetail): string[] {
  const input = typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input);
  const result = tool.result
    ? [
        tool.result.isError ? "result (error):" : "result:",
        ...lines(tool.result.content).map((line) => `  ${line}`),
      ]
    : ["result: (none yet)"];
  return [
    tool.name,
    `input: ${input}`,
    ...result,
    ...(tool.truncated ? ["(cut: the transcript holds more)"] : []),
  ];
}

/** One change `history watch` pushes: the session, where it ran and when it last grew. */
export type HistoryChange = Omit<HistoryChanged, "type">;

/** The line `history watch` prints for a change: the same columns as `history list`. */
export function watchLine(change: HistoryChange): string {
  const running = change.maybeActive ? " [may be running]" : "";
  return `${change.claudeSessionId}  ${change.lastTs ?? "-"}  ${change.cwd}${running}`;
}

/** The change as `--json` prints it, without the frame's `type`. */
export function changeJson(change: HistoryChange): string {
  const { claudeSessionId, cwd, lastTs, maybeActive } = change;
  return JSON.stringify({ claudeSessionId, cwd, lastTs, maybeActive });
}

/** What a resume that got no answer may have done, as text that follows the message. */
export const UNSURE =
  "; the session may or may not have been started: check with `sessions` before trying again";
