/**
 * What a person typed in a user turn of a Claude Code transcript. The harness puts its own text in
 * the same turns (reminders, command echoes, pasted blocks); that is not something they asked.
 * Shared by the History title and the session summary.
 */

/** Tags the harness wraps its text in; a block is dropped with what is inside it. */
const WRAPPER_TAGS =
  "system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|command-name|command-message|command-args|pasted_content";
const CLOSED = new RegExp(String.raw`<(${WRAPPER_TAGS})\b[^>]*>[\s\S]*?</\1>`, "g");
/** A block whose end was cut off (a long message is stored cut): it runs to the end of the text. */
const OPEN = new RegExp(String.raw`<(?:${WRAPPER_TAGS})\b[^>]*>[\s\S]*$`);

/** The text of a message `content` (a string, or blocks with text blocks among them). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block !== null &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

/** The person's own text in a user turn, wrappers dropped; `null` when nothing is left. */
export function promptText(content: unknown): string | null {
  const text = textOf(content).replace(CLOSED, "").replace(OPEN, "").trim();
  return text === "" ? null : text;
}
