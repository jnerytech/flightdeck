/**
 * Best-effort reader for Claude Code transcript lines (`~/.claude/projects/<dir>/<id>.jsonl`).
 * The format is internal and changes between versions: anything unexpected is kept raw.
 */
import { createHash } from "node:crypto";

export type HistoryKind = "message" | "tool_result" | "summary" | "system" | "raw";
export type HistoryRole = "user" | "assistant" | "system" | "summary";

export interface HistoryRecord {
  uuid: string;
  ts: string | null;
  role: HistoryRole | null;
  kind: HistoryKind;
  /** Searchable text; for `raw` the untouched line. */
  text: string;
  cwd: string | null;
}

export interface ParseResult {
  records: HistoryRecord[];
  /** Lines that were not valid JSON. */
  errors: number;
}

/** Messages are cut to this many UTF-8 bytes. */
export const MAX_TEXT_BYTES = 8 * 1024;

/** Cuts `text` to at most `maxBytes` of UTF-8 without splitting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Back off continuation bytes (10xxxxxx) to the start of the cut character.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

type Line = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

interface Block {
  type?: unknown;
  text?: unknown;
  name?: unknown;
}

/** Text of a message's content: text blocks as is, one `[ferramenta Nome]` line per tool call. */
function contentText(content: unknown): { text: string; toolResults: number } | null {
  if (typeof content === "string") return { text: content, toolResults: 0 };
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  let toolResults = 0;
  for (const block of content as Block[]) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block?.type === "tool_use") parts.push(`[ferramenta ${String(block.name)}]`);
    else if (block?.type === "tool_result") toolResults++;
  }
  return { text: parts.join("\n"), toolResults };
}

function normalize(line: Line, raw: string): HistoryRecord {
  const base = {
    uuid: str(line.uuid) ?? `raw:${createHash("sha1").update(raw).digest("hex").slice(0, 16)}`,
    ts: str(line.timestamp),
    cwd: str(line.cwd),
  };
  const cut = (text: string) => truncateUtf8(text, MAX_TEXT_BYTES);
  const message = line.message as { content?: unknown } | undefined;
  switch (line.type) {
    case "user":
    case "assistant": {
      const content = contentText(message?.content);
      if (!content) break;
      const role = line.type;
      if (role === "user" && content.text === "" && content.toolResults > 0) {
        return { ...base, role, kind: "tool_result", text: "" };
      }
      return { ...base, role, kind: "message", text: cut(content.text) };
    }
    case "system": {
      const text = str(line.content);
      if (text === null) break;
      return { ...base, role: "system", kind: "system", text: cut(text) };
    }
    case "summary": {
      const text = str(line.summary);
      if (text === null) break;
      const uuid = `summary:${str(line.leafUuid) ?? base.uuid}`;
      return { ...base, uuid, role: "summary", kind: "summary", text: cut(text) };
    }
  }
  return { ...base, role: null, kind: "raw", text: raw };
}

/** One transcript line; `null` when it is not valid JSON. */
export function parseLine(line: string): HistoryRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const object = value !== null && typeof value === "object" ? (value as Line) : {};
  return normalize(object, line);
}

/** Every complete line of a chunk; blank lines are skipped and invalid ones counted. */
export function parseLines(text: string): ParseResult {
  const records: HistoryRecord[] = [];
  let errors = 0;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") continue;
    const record = parseLine(line);
    if (record) records.push(record);
    else errors++;
  }
  return { records, errors };
}
