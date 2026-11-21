/** Issue #3616: what `flightdeckd mcp` prints, as pure functions of what the daemon answered. */
import type { McpLiveStatus, McpServerView } from "@flightdeck/protocol";

/** What `mcp.test` answers without `confirm`: the command or the link a test would run. */
type McpPreview = { command?: string; args?: string[]; url?: string };

/** A server with every key a script reads: what it has none of is `null`. The daemon already masked its secrets. */
export const serverJson = (server: McpServerView) => ({
  ...server,
  type: server.type ?? null,
  command: server.command ?? null,
  args: server.args ?? null,
  env: server.env ?? null,
  url: server.url ?? null,
  headers: server.headers ?? null,
});

/** The names of the secrets of a server, never their values: a terminal's output is kept. */
const secretNames = (label: string, values: Record<string, string> | undefined): string[] =>
  values && Object.keys(values).length > 0 ? [`${label} ${Object.keys(values).join(", ")}`] : [];

/** A server as one line: name, origin, transport, on or off, access, what it runs, and the names of its secrets. */
const serverLine = (server: McpServerView): string =>
  [
    server.name,
    server.origin,
    server.transport,
    server.enabled ? "on" : "off",
    server.readOnly ? "read-only" : "editable",
    server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" "),
    ...secretNames("env", server.env),
    ...secretNames("headers", server.headers),
  ]
    .filter((field) => field !== "")
    .join("  ");

export const listLines = (servers: readonly McpServerView[]): string[] =>
  servers.length === 0 ? ["no MCP servers"] : servers.map(serverLine);

export const statusJson = (status: McpLiveStatus) => ({ ...status, error: status.error ?? null });

export const statusLines = (servers: readonly McpLiveStatus[]): string[] =>
  servers.length === 0
    ? ["no MCP servers"]
    : servers.map((s) =>
        [s.name, s.status, s.error].filter((part) => part !== undefined).join("  "),
      );

/** What a test would run, with the keys a script reads. */
export const previewJson = (preview: McpPreview) => ({
  command: preview.command ?? null,
  args: preview.args ?? null,
  url: preview.url ?? null,
});

export const previewLine = (preview: McpPreview): string => {
  if (preview.url !== undefined) return `would connect to: ${preview.url}`;
  if (preview.command === undefined) return "nothing to run: the server has no command and no link";
  return `would run: ${[preview.command, ...(preview.args ?? [])].join(" ")}`;
};

/** What a started server offers, with both lists a script reads. */
export const testJson = (result: { tools: string[]; resources: string[] }) => ({
  tools: result.tools,
  resources: result.resources,
});

const offered = (label: string, names: string[]) =>
  `${label}: ${names.length === 0 ? "none" : names.join(", ")}`;

export const testLines = (result: { tools: string[]; resources: string[] }): string[] => [
  offered("tools", result.tools),
  offered("resources", result.resources),
];
