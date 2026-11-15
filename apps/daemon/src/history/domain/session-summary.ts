import type { HistoryRecord } from "./parser.ts";
import { promptText } from "./transcript-text.ts";

/** A title made from a prompt is cut to this many characters. */
const TITLE_CHARS = 120;

/** The first `TITLE_CHARS` characters (code points) of a prompt, or null when there is none. */
export function titleFrom(prompt: string | null | undefined): string | null {
  return prompt == null ? null : Array.from(prompt).slice(0, TITLE_CHARS).join("");
}

/**
 * The title of a session after reading `records`: the latest summary line, else the title already
 * stored, else the first user prompt that has real text.
 */
export function sessionTitle(records: HistoryRecord[], stored: string | null): string | null {
  const summary = records
    .slice()
    .reverse()
    .find((r) => r.kind === "summary")?.text;
  const firstUser = records
    .filter((r) => r.kind === "message" && r.role === "user")
    .map((r) => promptText(r.text))
    .find((text) => text !== null);
  return summary ?? stored ?? titleFrom(firstUser);
}

/** How Claude Code was started, from the first record that says so. */
export function entrypointOf(records: HistoryRecord[]): string | null {
  return records.find((r) => r.entrypoint)?.entrypoint ?? null;
}
