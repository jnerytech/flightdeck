/**
 * Phase 39 (ADR 39-1): what OpenCode's global and system scopes would load, read from the files
 * without starting OpenCode (starting it would already import a plugin). Project config is off for
 * every OpenCode process Flightdeck starts, so only these scopes remain. A finding makes OpenCode
 * unavailable on the host; the fingerprint lets a live session notice a change.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type ScopeFindingKind =
  | "plugins_entry"
  | "plugin_file"
  | "mcp_server"
  | "system_config"
  | "managed_config"
  | "unreadable_config";

export interface ScopeFinding {
  kind: ScopeFindingKind;
  path: string;
  /** The plugin id or the server name, when there is one. */
  detail?: string;
}

export interface ScopeResult {
  findings: ScopeFinding[];
  /** Changes when a config file or a plugin file is added, changed or removed. */
  fingerprint: string;
}

export interface ScopeOptions {
  /** The OpenCode child's environment (HOME, USERPROFILE, XDG_CONFIG_HOME). */
  env: Record<string, string | undefined>;
  /** System config folders; `/etc/opencode` when absent. */
  systemDirs?: string[];
  /** Folders holding managed preferences (macOS); none when absent. */
  managedDirs?: string[];
}

export const CONFIG_FILES = ["opencode.json", "opencode.jsonc", "config.json"];
const PLUGIN_DIRS = ["plugins", "plugin"];
/** Files under a plugin folder that the fingerprint reads at most (a plugin may bring node_modules). */
const MAX_FILES = 2000;

/** `$XDG_CONFIG_HOME/opencode`, else `<home>/.config/opencode`; "" with no home at all. */
export function globalConfigDir(env: Record<string, string | undefined>): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "opencode");
  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, ".config", "opencode") : "";
}

async function entries(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [] as string[])).sort();
}

/** Every file under `dir` (relative paths, sorted), up to the cap. */
async function walk(dir: string, out: string[], root = dir): Promise<void> {
  for (const name of await entries(dir)) {
    if (out.length >= MAX_FILES) return;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) await walk(path, out, root);
    else if (info) out.push(relative(root, path));
  }
}

/** A plugin entry's id; a removal (`-id`) is none, and an unknown shape fails closed as itself. */
function pluginId(entry: unknown): string | null {
  if (typeof entry === "string") return entry.startsWith("-") ? null : entry;
  const pkg = (entry as { package?: unknown } | null)?.package;
  return typeof pkg === "string" ? pkg : JSON.stringify(entry);
}

/** The MCP servers a config turns on: v2 `mcp.servers`, or names directly under `mcp`. */
function mcpServers(mcp: unknown): string[] {
  if (!mcp || typeof mcp !== "object") return [];
  const record = mcp as Record<string, unknown>;
  const servers = (
    record.servers && typeof record.servers === "object" ? record.servers : record
  ) as Record<string, unknown>;
  return Object.entries(servers)
    .filter(
      ([name, server]) =>
        name !== "servers" && (server as { disabled?: unknown })?.disabled !== true,
    )
    .map(([name]) => name);
}

function findingsOf(path: string, text: string): ScopeFinding[] {
  let config: { plugins?: unknown; mcp?: unknown };
  try {
    config = (Bun.JSONC.parse(text) ?? {}) as typeof config;
  } catch {
    return [{ kind: "unreadable_config", path }];
  }
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  return [
    ...plugins.flatMap((entry) => {
      const id = pluginId(entry);
      return id ? [{ kind: "plugins_entry" as const, path, detail: id }] : [];
    }),
    ...mcpServers(config.mcp).map((name) => ({ kind: "mcp_server" as const, path, detail: name })),
  ];
}

export async function scanOpenCodeScope(opts: ScopeOptions): Promise<ScopeResult> {
  const findings: ScopeFinding[] = [];
  const hash = createHash("sha256");
  const fingerprint = async (path: string) => {
    const info = await stat(path).catch(() => null);
    hash.update(`${path}\0${info ? `${info.size}:${info.mtimeMs}` : "-"}\n`);
  };

  const global = globalConfigDir(opts.env);
  if (global) {
    for (const name of CONFIG_FILES) {
      const path = join(global, name);
      await fingerprint(path);
      const text = await readFile(path, "utf8").catch(() => null);
      if (text !== null) findings.push(...findingsOf(path, text));
    }
    for (const dir of PLUGIN_DIRS) {
      const root = join(global, dir);
      for (const name of await entries(root)) {
        findings.push({ kind: "plugin_file", path: join(root, name), detail: name });
      }
      const files: string[] = [];
      await walk(root, files);
      for (const file of files) await fingerprint(join(root, file));
    }
  }

  for (const dir of opts.systemDirs ?? ["/etc/opencode"]) {
    for (const name of CONFIG_FILES) {
      const path = join(dir, name);
      await fingerprint(path);
      if (await stat(path).catch(() => null)) findings.push({ kind: "system_config", path });
    }
  }
  for (const dir of opts.managedDirs ?? []) {
    for (const name of await entries(dir)) {
      if (!name.toLowerCase().includes("opencode")) continue;
      const path = join(dir, name);
      await fingerprint(path);
      findings.push({ kind: "managed_config", path });
    }
  }
  return { findings, fingerprint: hash.digest("hex") };
}
