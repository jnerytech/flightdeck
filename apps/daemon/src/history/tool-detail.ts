import { truncateUtf8 } from "./parser.ts";

/** A tool call of a stored transcript with its whole input and its result (#606). */
export interface ToolDetail {
  name: string;
  /** The input as the call had it; the pretty JSON text cut to the cap when it was bigger. */
  input: unknown;
  /** `null` while there is no result in the transcript (still running, or cut short). */
  result: { content: string; isError: boolean } | null;
  /** The input or the result was cut to the cap. */
  truncated: boolean;
}

/** The input and the result are each cut to this many UTF-8 bytes. */
export const MAX_TOOL_BYTES = 64 * 1024;

interface Block {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  is_error?: unknown;
  text?: unknown;
}

/** The content blocks of a transcript line, or none when it is not JSON or has no list. */
function blocks(line: string): { uuid: unknown; content: Block[] } {
  try {
    const parsed = JSON.parse(line) as { uuid?: unknown; message?: { content?: unknown } };
    const content = parsed?.message?.content;
    return { uuid: parsed?.uuid, content: Array.isArray(content) ? (content as Block[]) : [] };
  } catch {
    return { uuid: null, content: [] };
  }
}

/** A result's content as text: a string as is, a list's text blocks one per line, an image as `[image]`. */
function resultText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return (content as Block[])
    .map((b) =>
      b?.type === "text" && typeof b.text === "string" ? b.text : `[${String(b?.type)}]`,
    )
    .join("\n");
}

/** `text` cut to the cap, and whether it was cut. */
function capped(text: string): [string, boolean] {
  const cut = truncateUtf8(text, MAX_TOOL_BYTES);
  return [cut, cut.length < text.length];
}

/**
 * The `index`-th tool call of the message `uuid` in `lines`, paired with the result that names its
 * id in the lines after it. It reads no further than it needs to.
 */
export async function toolDetail(
  lines: AsyncIterable<string>,
  uuid: string,
  index: number,
): Promise<ToolDetail | null> {
  let found: { id: unknown; name: string; input: unknown; truncated: boolean } | null = null;
  for await (const line of lines) {
    const { uuid: own, content } = blocks(line);
    if (!found) {
      if (own !== uuid) continue;
      const use = content.filter((b) => b?.type === "tool_use")[index];
      if (!use) return null;
      const whole = JSON.stringify(use.input ?? null, null, 2);
      const [cut, truncated] = capped(whole);
      found = {
        id: use.id,
        name: String(use.name),
        input: truncated ? cut : (use.input ?? null),
        truncated,
      };
      continue;
    }
    const result = content.find((b) => b?.type === "tool_result" && b.tool_use_id === found?.id);
    if (!result) continue;
    const [text, cut] = capped(resultText(result.content));
    return {
      name: found.name,
      input: found.input,
      result: { content: text, isError: result.is_error === true },
      truncated: found.truncated || cut,
    };
  }
  return found
    ? { name: found.name, input: found.input, result: null, truncated: found.truncated }
    : null;
}
