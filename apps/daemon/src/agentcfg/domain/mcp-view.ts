// Pure rules of the MCP server list: what the app shows (secrets masked), which values refuse a save.

/** What secrets (env and headers values) look like in the app. */
export const MASK = "••••••";

export interface McpServerConfig {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerView extends McpServerConfig {
  name: string;
  /** `project` (.mcp.json), `user` or `user-project` (both from ~/.claude.json). */
  origin: "project" | "user" | "user-project";
  readOnly: boolean;
  transport: "stdio" | "http" | "sse";
  enabled: boolean;
}

const masked = (values?: Record<string, string>) =>
  values ? Object.fromEntries(Object.keys(values).map((k) => [k, MASK])) : undefined;

/** One server as the app lists it: secrets masked, where it comes from, whether it is on. */
export function viewOf(
  name: string,
  config: McpServerConfig,
  origin: McpServerView["origin"],
  disabled: string[],
): McpServerView {
  const { env, headers, ...rest } = config;
  return {
    name,
    ...rest,
    ...(env ? { env: masked(env) } : {}),
    ...(headers ? { headers: masked(headers) } : {}),
    origin,
    readOnly: origin !== "project",
    transport: config.type ?? (config.url ? "http" : "stdio"),
    enabled: origin !== "project" || !disabled.includes(name),
  };
}

/** True when an env or header value still shows the mask, so saving it would write the mask over a secret. */
export function hasMaskedSecret(config: McpServerConfig): boolean {
  const secrets = { ...config.env, ...config.headers };
  return Object.values(secrets).includes(MASK);
}

/** The enabled and disabled lists of settings.local.json once `name` is turned on or off. */
export function toggleLists(
  current: Record<string, unknown>,
  name: string,
  enabled: boolean,
): { disabledMcpjsonServers: string[]; enabledMcpjsonServers: string[] } {
  const without = (key: string) => ((current[key] ?? []) as string[]).filter((n) => n !== name);
  const on = without("enabledMcpjsonServers");
  const off = without("disabledMcpjsonServers");
  return {
    disabledMcpjsonServers: enabled ? off : [...off, name],
    enabledMcpjsonServers: enabled ? [...on, name] : on,
  };
}
