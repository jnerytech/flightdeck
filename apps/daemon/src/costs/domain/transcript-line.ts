import type { UsageTokens } from "../../kernel/index.ts";
import { parseJsonText } from "../../kernel/index.ts";

interface Usage {
  messageId: string;
  at: string;
  tokens: UsageTokens;
}

/** A transcript line as an object; text that is not JSON, or JSON that is no object, is no line. */
function objectOf(line: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = parseJsonText(line);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown) => (typeof value === "string" ? value : null);

/** Error replies of the CLI itself: no model ran, nothing was used. */
const SYNTHETIC_MODEL = "<synthetic>";

/** Tools that write a file, and where their input names it (phase 11). */
const FILE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** A tool call that wrote a file: its id (unique per call) and the path as written. */
export interface FileEdit {
  toolUseId: string;
  path: string;
}

/** The file writes among a message's content blocks. */
function editsOf(content: unknown): FileEdit[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: Record<string, unknown>) => {
    const field = block?.type === "tool_use" ? FILE_TOOLS[String(block.name)] : undefined;
    const input = block?.input as Record<string, unknown> | undefined;
    const toolUseId = str(block?.id);
    const path = field ? str(input?.[field]) : null;
    return toolUseId && path ? [{ toolUseId, path }] : [];
  });
}

interface ReadLine {
  cwd: string | null;
  at: string | null;
  usage: Usage | null;
  edits: FileEdit[];
}

/** The `cwd` of a transcript line, the usage of an assistant message and its file writes. */
export function readLine(line: string): ReadLine {
  const value = objectOf(line);
  if (!value) return { cwd: null, at: null, usage: null, edits: [] };
  const cwd = str(value.cwd);
  const message = value.type === "assistant" ? (value.message as Record<string, unknown>) : null;
  const messageId = str(message?.id);
  const model = str(message?.model);
  const at = str(value.timestamp);
  const usage = message?.usage as Record<string, unknown> | undefined;
  const edits = editsOf(message?.content);
  if (!messageId || !model || model === SYNTHETIC_MODEL || !at || !usage) {
    return { cwd, at, usage: null, edits };
  }
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  return {
    cwd,
    at,
    edits,
    usage: {
      messageId,
      at,
      tokens: {
        model,
        speed: str(usage.speed) ?? "standard",
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
        // Without the split, the whole cache write counts as the 5-minute one.
        cacheWrite5m: split
          ? count(split.ephemeral_5m_input_tokens)
          : count(usage.cache_creation_input_tokens),
        cacheWrite1h: split ? count(split.ephemeral_1h_input_tokens) : 0,
      },
    },
  };
}
