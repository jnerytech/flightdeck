import type { McpServerView } from "@flightdeck/protocol";

type Transport = McpServerView["transport"];

/** What the daemon shows in place of an env or header value it hides. */
export const MASK = "••••••";

/** The form of an MCP server: lists are one entry per line. */
export interface McpDraft {
  name: string;
  transport: Transport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  /** An existing server: its name stays. */
  editing: boolean;
}

export const emptyDraft = (): McpDraft => ({
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  editing: false,
});

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** `NAME<sep>value` lines as a record (the value may hold the separator again). */
function pairs(text: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(separator);
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

const spell = (record: Record<string, string> | undefined, separator: string) =>
  Object.entries(record ?? {})
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");

export function draftFromServer(server: McpServerView): McpDraft {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join("\n"),
    env: spell(server.env, "="),
    url: server.url ?? "",
    headers: spell(server.headers, ": "),
    editing: true,
  };
}

/** The server as `mcp.save` takes it: only what the transport uses, nothing empty. */
export function serverFromDraft(draft: McpDraft) {
  const env = pairs(draft.env, "=");
  const headers = pairs(draft.headers, ":");
  const nonEmpty = (record: Record<string, string>) =>
    Object.keys(record).length > 0 ? record : undefined;
  if (draft.transport === "stdio") {
    const args = lines(draft.args);
    return {
      name: draft.name.trim(),
      command: draft.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(nonEmpty(env) ? { env } : {}),
    };
  }
  return {
    name: draft.name.trim(),
    type: draft.transport,
    url: draft.url.trim(),
    ...(nonEmpty(headers) ? { headers } : {}),
  };
}

/** Whether a secret is still the mask: the daemon refuses to save it. */
export const hasMask = (draft: McpDraft) =>
  draft.transport === "stdio"
    ? Object.values(pairs(draft.env, "=")).includes(MASK)
    : Object.values(pairs(draft.headers, ":")).includes(MASK);

/** The dictionary key of what stops the draft from being saved, if anything. */
export function draftProblem(
  draft: McpDraft,
): "needName" | "needCommand" | "needUrl" | "retype" | null {
  if (draft.name.trim() === "") return "needName";
  if (draft.transport === "stdio" && draft.command.trim() === "") return "needCommand";
  if (draft.transport !== "stdio" && draft.url.trim() === "") return "needUrl";
  return hasMask(draft) ? "retype" : null;
}

/** The command as one line, an argument with a space or none in quotes; or the URL. */
export function commandLine(target: { command?: string; args?: string[]; url?: string }): string {
  if (target.url) return target.url;
  const word = (arg: string) => (arg === "" || /\s/.test(arg) ? JSON.stringify(arg) : arg);
  return [target.command ?? "", ...(target.args ?? [])].map(word).join(" ");
}
