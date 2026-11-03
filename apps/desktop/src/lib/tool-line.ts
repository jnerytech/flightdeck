/** A piece of a stored message: prose, or a tool call the daemon wrote as one line. */
export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: string };

/** `[tool Name] input`, or the older `[ferramenta Name]` an earlier daemon stored. */
const TOOL_LINE = /^\[(?:tool|ferramenta) (\S+)\](?: (.*))?$/;

/** A message's text as prose and tool calls, in order; neighbouring prose lines stay together. */
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let prose: string[] = [];
  const flush = () => {
    const joined = prose.join("\n").trim();
    if (joined) parts.push({ kind: "text", text: joined });
    prose = [];
  };
  for (const line of text.split("\n")) {
    const call = TOOL_LINE.exec(line);
    if (call) {
      flush();
      parts.push({ kind: "tool", name: call[1] as string, input: call[2] ?? "" });
    } else prose.push(line);
  }
  flush();
  return parts;
}
