/**
 * Phase 39 (ADR 39-1): what OpenCode's global and system scopes would load, read from the files
 * without starting OpenCode (starting it would already import a plugin). Project config is off for
 * every OpenCode process Flightdeck starts, so only these scopes remain. A finding makes OpenCode
 * unavailable on the host; the fingerprint lets a live session notice a change.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { byCodeUnit, inSequence } from "@flightdeck/protocol";

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
  /** Folders holding managed preferences; macOS's (`defaultManagedDirs`) when absent. */
  managedDirs?: string[];
}

export const CONFIG_FILES = ["opencode.json", "opencode.jsonc", "config.json"];
/** Folders whose files OpenCode imports as code (v2 and v1 names). */
const PLUGIN_DIRS = ["plugins", "plugin", "tools", "tool"];
/** A file that is not there (or went away while the scan ran) reads as `null`. */
const absent = (): null => null;

/** Files under a plugin folder that the fingerprint reads at most (a plugin may bring node_modules). */
const MAX_FILES = 2000;

/** Where macOS keeps managed preferences (the machine's, then the user's); none elsewhere. */
export function defaultManagedDirs(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform !== "darwin") return [];
  const root = "/Library/Managed Preferences";
  return env.USER ? [root, join(root, env.USER)] : [root];
}

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
  return (await readdir(dir).catch(() => [] as string[])).sort(byCodeUnit);
}

/** Every file under `dir` (relative paths, sorted), up to the cap. */
async function walk(dir: string, out: string[], root = dir): Promise<void> {
  await inSequence(await entries(dir), async (name) => {
    if (out.length >= MAX_FILES) return;
    const path = join(dir, name);
    const info = await stat(path).catch(absent);
    if (info?.isDirectory()) await walk(path, out, root);
    else if (info) out.push(relative(root, path));
  });
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

/** The `plugins` (v2) and `plugin` (v1) lists of a config: each entry, a shape nobody expects fails closed. */
function pluginFindings(path: string, config: Record<string, unknown>): ScopeFinding[] {
  const findings: ScopeFinding[] = [];
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
  return findings;
}

/** The enabled MCP servers of a config; a `mcp` that is not an object fails closed. */
function mcpFindings(path: string, mcp: unknown): ScopeFinding[] {
  if (mcp === undefined) return [];
  if (!isObject(mcp)) return [{ kind: "unreadable_config", path, detail: "mcp" }];
  return mcpServers(mcp).map((name): ScopeFinding => ({ kind: "mcp_server", path, detail: name }));
}

function findingsOf(path: string, text: string): ScopeFinding[] {
  let config: Record<string, unknown>;
  try {
    config = (Bun.JSONC.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    return [{ kind: "unreadable_config", path }];
  }
  // v2 `plugins`, and the v1 `plugin` OpenCode still reads.
  return [...pluginFindings(path, config), ...mcpFindings(path, config.mcp)];
}

/** A finding as one line: its kind, the detail when there is one, and the path. */
export function findingText(f: ScopeFinding): string {
  const detail = f.detail ? ` ${f.detail}` : "";
  return `${f.kind}${detail} (${f.path})`;
}

type Fingerprint = (path: string) => Promise<void>;

/** The global config files, and the plugin folders: what they hold and how they look. */
async function scanGlobal(
  global: string,
  findings: ScopeFinding[],
  fingerprint: Fingerprint,
): Promise<void> {
  await inSequence(CONFIG_FILES, async (name) => {
    const path = join(global, name);
    await fingerprint(path);
    const text = await readFile(path, "utf8").catch(absent);
    if (text !== null) findings.push(...findingsOf(path, text));
  });
  await inSequence(PLUGIN_DIRS, async (dir) => {
    const root = join(global, dir);
    for (const name of await entries(root)) {
      findings.push({ kind: "plugin_file", path: join(root, name), detail: name });
    }
    const files: string[] = [];
    await walk(root, files);
    await inSequence(files, (file) => fingerprint(join(root, file)));
  });
}

/** The entries of a folder that `keep` accepts, each one a finding of `kind` and part of the fingerprint. */
async function scanFolder(
  dir: string,
  kind: "system_config" | "managed_config",
  keep: (name: string) => boolean,
  findings: ScopeFinding[],
  fingerprint: Fingerprint,
): Promise<void> {
  await inSequence(await entries(dir), async (name) => {
    if (!keep(name)) return;
    const path = join(dir, name);
    await fingerprint(path);
    findings.push({ kind, path });
  });
}

export async function scanOpenCodeScope(opts: ScopeOptions): Promise<ScopeResult> {
  const findings: ScopeFinding[] = [];
  const hash = createHash("sha256");
  const fingerprint: Fingerprint = async (path) => {
    const info = await stat(path).catch(absent);
    const state = info ? `${info.size}:${info.mtimeMs}` : "-";
    hash.update(`${path}\0${state}\n`);
  };

  const global = globalConfigDir(opts.env);
  if (global) await scanGlobal(global, findings, fingerprint);
  // Anything in the system folder fails closed: it outranks the global config (OpenCode's config docs).
  await inSequence(opts.systemDirs ?? ["/etc/opencode"], (dir) =>
    scanFolder(dir, "system_config", () => true, findings, fingerprint),
  );
  await inSequence(opts.managedDirs ?? defaultManagedDirs(process.platform, opts.env), (dir) =>
    scanFolder(
      dir,
      "managed_config",
      (name) => name.toLowerCase().includes("opencode"),
      findings,
      fingerprint,
    ),
  );
  return { findings, fingerprint: hash.digest("hex") };
}
