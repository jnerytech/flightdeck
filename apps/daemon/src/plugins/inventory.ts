/**
 * Phase 26: what a plugin would install, read from its folder without running anything: the
 * manifest, the hooks and the events they listen to, the monitors, skills, agents, commands and
 * MCP servers, plus a hash of the whole content. A plugin runs code on the machine, so the person
 * sees this before any install or update, and the hash ties the confirmation to what was shown.
 */

/** Hook events that can decide for the user; a plugin listening to them gets the attention mark. */
export const SENSITIVE_EVENTS = ["PreToolUse", "PermissionRequest"];

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

export function inspectPlugin(_dir: string): PluginInventory {
  return {
    manifest: null,
    hooks: [],
    monitors: [],
    skills: [],
    agents: [],
    commands: [],
    mcpServers: [],
    attention: false,
    hash: "",
    files: 0,
    bytes: 0,
    problems: [],
  };
}
