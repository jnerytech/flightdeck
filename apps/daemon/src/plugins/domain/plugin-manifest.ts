/**
 * Phase 26: what a plugin's manifest, hook maps, monitor lists and MCP server maps say, read from
 * parsed JSON without touching the disk (#1601). The inventory reads the folder; these shape what it
 * found into the inventory the person sees before an install or an update.
 */

/** Hook events that can decide for the user; a plugin listening to them gets the attention mark. */
const SENSITIVE_EVENTS = new Set(["PreToolUse", "PermissionRequest"]);

export interface PluginHook {
  event: string;
  matcher?: string;
  type: string;
  /** The command or URL the hook runs, as written. Shown, never executed. */
  command?: string;
  /** Listens to an event that can allow or deny a tool use. */
  sensitive: boolean;
}

export interface PluginMonitor {
  name: string;
  command: string;
  description: string;
  when: string;
}

export interface PluginMcpServer {
  name: string;
  transport: string;
  /** The command (stdio) or the URL (remote), as written. */
  target: string;
}

export interface PluginInventory {
  manifest: { name?: string; version?: string; description?: string; author?: string } | null;
  hooks: PluginHook[];
  monitors: PluginMonitor[];
  skills: string[];
  agents: string[];
  commands: string[];
  mcpServers: PluginMcpServer[];
  /** Some hook listens to a sensitive event. */
  attention: boolean;
  /** sha256 over every file's path and bytes, in path order; `.git` is left out. */
  hash: string;
  files: number;
  bytes: number;
  /** What could not be read or was refused (a path outside the plugin, a broken file). */
  problems: string[];
}

export type Json = Record<string, unknown>;
export const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
export const asList = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

/** `{ key: value }` when the value is a non-empty string, else nothing to spread. */
const field = <K extends string>(key: K, value: unknown): { [P in K]?: string } => {
  const value_ = text(value);
  return value_ ? ({ [key]: value_ } as { [P in K]: string }) : {};
};

export function manifestOf(manifestJson: Json | null): PluginInventory["manifest"] {
  if (!manifestJson) return null;
  const author = manifestJson.author;
  return {
    ...field("name", manifestJson.name),
    ...field("version", manifestJson.version),
    ...field("description", manifestJson.description),
    ...field("author", isObject(author) ? author.name : author),
  };
}

/** The hooks of one event map: `{ Event: [{ matcher, hooks: [{ type, command… }] }] }`. */
export function hooksOfEvents(events: unknown): PluginHook[] {
  if (!isObject(events)) return [];
  const found: PluginHook[] = [];
  for (const [event, groups] of Object.entries(events)) {
    for (const group of asList(groups as unknown).filter(isObject)) {
      for (const hook of asList(group.hooks as unknown).filter(isObject)) {
        const args = Array.isArray(hook.args) ? hook.args.map(String) : [];
        const command = [text(hook.command) ?? text(hook.url) ?? text(hook.prompt), ...args]
          .filter((part): part is string => part !== undefined)
          .join(" ");
        found.push({
          event,
          ...field("matcher", group.matcher),
          type: text(hook.type) ?? "command",
          ...(command ? { command } : {}),
          sensitive: SENSITIVE_EVENTS.has(event),
        });
      }
    }
  }
  return found;
}

export function monitorsOfList(list: unknown): PluginMonitor[] {
  return asList(list as unknown)
    .filter(isObject)
    .flatMap((item) =>
      text(item.name) && text(item.command)
        ? [
            {
              name: text(item.name) as string,
              command: text(item.command) as string,
              description: text(item.description) ?? "",
              when: text(item.when) ?? "always",
            },
          ]
        : [],
    );
}

export function serversOfMap(map: unknown): Array<[string, PluginMcpServer]> {
  const list = isObject(map) && isObject(map.mcpServers) ? map.mcpServers : map;
  if (!isObject(list)) return [];
  return Object.entries(list)
    .filter((entry): entry is [string, Json] => isObject(entry[1]))
    .map(([name, server]) => {
      const url = text(server.url);
      const args = Array.isArray(server.args) ? server.args.map(String) : [];
      const fallback = url ? "http" : "stdio";
      return [
        name,
        {
          name,
          transport: text(server.type) ?? fallback,
          target: url ?? [text(server.command) ?? "", ...args].join(" ").trim(),
        },
      ];
    });
}
