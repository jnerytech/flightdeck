import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { parseJsonText } from "../json-text.ts";

/** What a session started in a terminal waits for, read from the end of its transcript (#1736). */
export type Waiting = "plan" | "question";

/** The last bytes of a transcript, and the size and time they were read at (a cache key). */
export interface Tail {
  text: string;
  size: number;
  mtimeMs: number;
}

/** How much of a transcript's end is read: a plan or a question is the last entry, never far back. */
export const TAIL_BYTES = 64 * 1024;

const WAITS: Record<string, Waiting> = { ExitPlanMode: "plan", AskUserQuestion: "question" };

/**
 * Whether the transcript's tail ends at a plan approval or a question put to the person: the last
 * assistant entry is a tool call to `ExitPlanMode` or `AskUserQuestion` and nothing answers it.
 * Claude Code writes one entry per content block, so the call is the entry's last block.
 */
export function waitingIn(tail: string): Waiting | null {
  const lines = tail.split("\n");
  for (let at = lines.length - 1; at >= 0; at--) {
    const entry = parse(lines[at] ?? "");
    // A line that is not an entry (a partial one at the start of the tail, another kind) is skipped.
    if (!entry || entry.isSidechain === true) continue;
    // A person's entry after the call answers it (a tool result) or moves on (a new prompt).
    if (entry.type === "user") return null;
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    const last = Array.isArray(content) ? content[content.length - 1] : null;
    // Own keys only: a tool named `constructor` or `__proto__` must not find an inherited member.
    const name = String(last?.name);
    return last?.type === "tool_use" && Object.hasOwn(WAITS, name) ? (WAITS[name] ?? null) : null;
  }
  return null;
}

interface Entry {
  type?: unknown;
  isSidechain?: unknown;
  message?: { content?: Array<{ type?: unknown; name?: unknown }> | unknown };
}

function parse(line: string): Entry | null {
  if (!line.startsWith("{")) return null;
  try {
    const value: unknown = parseJsonText(line);
    return value !== null && typeof value === "object" ? (value as Entry) : null;
  } catch {
    return null;
  }
}

/**
 * The end of a transcript, at most `TAIL_BYTES`, with the first line dropped when the read began
 * inside the file (it is cut). `null` when the file cannot be read: never throws.
 */
export async function tailOfFile(path: string): Promise<Tail | null> {
  try {
    const info = await stat(path);
    // A pipe or a device blocks `open` until something writes: only a regular file is read.
    if (!info.isFile()) return null;
    const start = Math.max(0, info.size - TAIL_BYTES);
    // Non-blocking, and checked again on the handle: the path may have been swapped since the stat.
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) return null;
      const buffer = Buffer.alloc(info.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let text = buffer.subarray(0, bytesRead).toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
      return { text, size: info.size, mtimeMs: info.mtimeMs };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
