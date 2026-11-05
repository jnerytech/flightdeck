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
/** Folders whose files OpenCode imports as code (v2 and v1 names). */
const PLUGIN_DIRS = ["plugins", "plugin", "tools", "tool"];
/** A file that is not there (or went away while the scan ran) reads as `null`. */
const absent = (): null => null;

/** Files under a plugin folder that the fingerprint reads at most (a plugin may bring node_modules). */
const MAX_FILES = 2000;

/** `$XDG_CONFIG_HOME/opencode`, else `<home>/.config/opencode`; "" with no home at all. */
export function globalConfigDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "opencode");
  // OpenCode's home is the system's: USERPROFILE on Windows, even when a shell set HOME.
  const home = platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE;
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
    const info = await stat(path).catch(absent);
    if (info?.isDirectory()) await walk(path, out, root);
    else if (info) out.push(relative(root, path));
  }
}

/** A plugin entry's id; a removal (`-id`) is none, and an unknown shape fails closed as itself. */
function pluginId(entry: unknown): string | null {
  if (typeof entry === "string") return entry.startsWith("-") ? null : entry;
  const pkg = (entry as { package?: unknown } | null)?.package;
  // Never the entry itself: its options may hold a key.
  return typeof pkg === "string" ? pkg : "(unknown entry)";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The MCP servers a config turns on: v2 `mcp.servers`, and v1 names directly under `mcp`. */
function mcpServers(mcp: Record<string, unknown>): string[] {
  const servers = isObject(mcp.servers) ? Object.entries(mcp.servers) : [];
  const v1 = Object.entries(mcp).filter(([name]) => name !== "servers");
  return [...servers, ...v1]
    .filter(([, server]) => isObject(server) && server.disabled !== true)
    .map(([name]) => name);
}

function findingsOf(path: string, text: string): ScopeFinding[] {
  let config: Record<string, unknown>;
  try {
    config = (Bun.JSONC.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    return [{ kind: "unreadable_config", path }];
  }
  const findings: ScopeFinding[] = [];
  // v2 `plugins`, and the v1 `plugin` OpenCode still reads; a shape nobody expects fails closed.
  for (const key of ["plugins", "plugin"]) {
    const list = config[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      findings.push({ kind: "unreadable_config", path, detail: key });
      continue;
    }
    for (const entry of list) {
      const id = pluginId(entry);
      if (id) findings.push({ kind: "plugins_entry", path, detail: id });
    }
  }
  if (config.mcp !== undefined) {
    if (!isObject(config.mcp)) findings.push({ kind: "unreadable_config", path, detail: "mcp" });
    else
      for (const name of mcpServers(config.mcp))
        findings.push({ kind: "mcp_server", path, detail: name });
  }
  return findings;
}

export async function scanOpenCodeScope(opts: ScopeOptions): Promise<ScopeResult> {
  const findings: ScopeFinding[] = [];
  const hash = createHash("sha256");
  const fingerprint = async (path: string) => {
    const info = await stat(path).catch(absent);
    hash.update(`${path}\0${info ? `${info.size}:${info.mtimeMs}` : "-"}\n`);
  };

  const global = globalConfigDir(opts.env);
  if (global) {
    for (const name of CONFIG_FILES) {
      const path = join(global, name);
      await fingerprint(path);
      const text = await readFile(path, "utf8").catch(absent);
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
      if (await stat(path).catch(absent)) findings.push({ kind: "system_config", path });
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
