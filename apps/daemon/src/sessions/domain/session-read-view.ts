/** Issue #3514: what `flightdeckd session interrupted|summary|files` print, as pure rules over the daemon's answers. */
import type { InterruptedSession, SessionFile, SessionRecap } from "@flightdeck/protocol";

/** A run time as the hours, minutes and seconds it has: `2m 5s`, `1h`, `0s`. */
function duration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const parts = [
    [Math.floor(total / 3600), "h"],
    [Math.floor((total % 3600) / 60), "m"],
    [total % 60, "s"],
  ] as const;
  const shown = parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`);
  return shown.length === 0 ? "0s" : shown.join(" ");
}

/** One line per session a restart interrupted, or a sentence when there is none. */
export function interruptedLines(sessions: InterruptedSession[]): string[] {
  if (sessions.length === 0) return ["no interrupted session"];
  return sessions.map((s) => {
    const last = s.lastRequest === null ? "" : `  last: ${s.lastRequest}`;
    return `${s.name ?? s.sessionId}  ${s.cwd}  ran ${duration(s.ranMs)}  interrupted ${s.interruptedAt}${last}`;
  });
}

const orDash = (text: string | null): string => text ?? "-";

/** What a recap says, a field to a line: a missing one is a dash, never the word null. */
export function recapLines(recap: SessionRecap): string[] {
  const files = [
    recap.files.length === 0 ? null : recap.files.join(", "),
    recap.filesMore > 0 ? `(${recap.filesMore} more)` : null,
  ].filter((part) => part !== null);
  return [
    `state: ${recap.state}`,
    `asked: ${orDash(recap.asked)}`,
    `done: ${orDash(recap.done)}`,
    `files: ${files.length === 0 ? "-" : files.join(" ")}`,
    `cost: ${recap.costUsd === null ? "-" : `$${recap.costUsd.toFixed(2)}`}`,
    ...(recap.question === null ? [] : [`question: ${recap.question}`]),
  ];
}

/** One line per file the session edited, or a sentence when there is none. */
export function filesLines(files: SessionFile[]): string[] {
  if (files.length === 0) return ["no file edited"];
  return files.map(
    (f) => `${f.path}  ${f.edits} ${f.edits === 1 ? "edit" : "edits"}  last ${f.lastAt}`,
  );
}
