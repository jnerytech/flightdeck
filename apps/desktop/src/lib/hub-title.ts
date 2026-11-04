import type { SessionPersona } from "@flightdeck/protocol";
import { basename } from "./paths.ts";

export interface TitleSources {
  name: string | null;
  /** The host's title for it: the summary Claude Code wrote, else the first prompt. */
  title: string | null;
  persona: SessionPersona | null;
  /** The first line of the user's last prompt. */
  request: string | null;
  cwd: string;
}

/** Blocks the system wraps around its own text: they say nothing about the session. */
const BLOCKS = [
  "task-notification",
  "local-command-stdout",
  "local-command-stderr",
  "local-command-caveat",
  "command-name",
  "command-message",
  "command-args",
];
const BLOCK = new RegExp(`<(${BLOCKS.join("|")})>[\\s\\S]*?</\\1>`, "g");
const OPEN_TAG = new RegExp(`</?(?:${BLOCKS.join("|")})>`, "g");
const SENT_MESSAGE = /^Another Claude session sent a message:/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI colors in a command's output
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The text of a title without the system's wrappers ("<task-notification>", "Another Claude
 * session sent a message:", local-command output), on one line; null when nothing is left.
 */
export function cleanTitle(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text
    .replace(ANSI, "")
    .replace(BLOCK, " ")
    .replace(OPEN_TAG, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(SENT_MESSAGE, "")
    .trim();
  return clean === "" ? null : clean;
}

/**
 * What a row calls a session: the name the person gave, then the host's title (the summary), then
 * the persona with the task, then the first prompt, then the folder.
 */
export function rowTitle(sources: TitleSources): string {
  const name = cleanTitle(sources.name);
  if (name) return name;
  const title = cleanTitle(sources.title);
  if (title) return title;
  const task = cleanTitle(sources.request);
  if (task && sources.persona) return `${sources.persona.name} · ${task}`;
  return task ?? basename(sources.cwd);
}
