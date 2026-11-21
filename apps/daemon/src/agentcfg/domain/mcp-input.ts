/**
 * Issue #3616: the server `flightdeckd mcp save` reads from a file or standard input, as pure rules over its
 * text. The text goes through the protocol's own schema, strictly, so a misspelled key is refused instead of
 * dropped (a server saved without its `command` would run nothing). A problem names the field and what is
 * wrong with it, never a value: an env or header value may be a secret, and the message ends on a terminal.
 */
import { McpServerInput } from "@flightdeck/protocol";
import type { z } from "zod";
import { parseJsonText } from "../../kernel/index.ts";

export type ServerFile = { server: z.infer<typeof McpServerInput> } | { problem: string };

/** The server a file describes, or the first thing wrong with it. */
export function serverFromText(text: string): ServerFile {
  let value: unknown;
  try {
    value = parseJsonText(text);
  } catch {
    return { problem: "the content is not JSON" };
  }
  const checked = McpServerInput.strict().safeParse(value);
  if (checked.success) {
    const { command, url } = checked.data;
    // The schema leaves both optional (the app fills them in as it goes), but a saved server with neither runs nothing.
    if (!command && !url)
      return { problem: "the server needs a command (stdio) or a url (http, sse)" };
    return { server: checked.data };
  }
  const issue = checked.error.issues[0];
  if (issue === undefined) return { problem: "the content is not a server" };
  if (issue.code === "unrecognized_keys")
    return { problem: `unknown field: ${issue.keys.join(", ")}` };
  const where = issue.path.map(String).join(".");
  return {
    problem: where === "" ? "the content must be one JSON object" : `${where}: ${issue.message}`,
  };
}
