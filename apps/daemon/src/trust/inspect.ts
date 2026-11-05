import type { Dirent } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isInside } from "../paths.ts";

/** What a project's own files would load into a Claude Code session, read without running anything (issue #196). */

export interface ProjectLoad {
  path: string;
  /** Shell commands that run on Claude Code events, by event name. */
  hooks: Array<{ event: string; file: string; commands: string[] }>;
  /** MCP servers the project declares: the name and the command that would start it. */
  mcpServers: Array<{ name: string; file: string; command: string }>;
  /** Names only: a value may be a secret. */
  envKeys: string[];
  allowRules: string[];
  defaultMode: string | null;
  agents: string[];
  skills: string[];
  commands: string[];
  claudeMd: boolean;
  executables: Array<{ key: string; file: string; command: string }>;
  redirects: Array<{ key: string; file: string; value: string }>;
  plugins: string[];
  otherKeys: string[];
  extras: Array<{ file: string; keys: string[] }>;
  /** Files that exist and could not be read as JSON, or are not what they seem. */
  unreadable: string[];
  /** How many entries of each list were left out because the list is capped. */
  omitted: { hooks: number; mcpServers: number; allowRules: number; envKeys: number };
}

const MAX_FILE = 256 * 1024;
const MAX_ITEMS = 100;
/** A command is shown whole up to this many characters; past it the cut says how much is left. */
const MAX_COMMAND = 4096;

/**
 * A command as written, every line: what runs once the project is trusted is what the person read.
 * Past the bound the text is cut with a count of the characters left out, never silently.
 */
function show(text: string): string {
  if (text.length <= MAX_COMMAND) return text;
  return `${text.slice(0, MAX_COMMAND)}\n[+${text.length - MAX_COMMAND} more characters]`;
}

/** Settings whose value is a program to run. */
const PROGRAM_KEYS = new Set([
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh",
  "otelHeadersHelper",
]);
/** Settings whose value is an object with a `command`. */
const PROGRAM_OBJECT_KEYS = new Set(["statusLine", "fileSuggestion"]);
/** Settings this listing explains elsewhere. */
const EXPLAINED_KEYS = new Set([
  "hooks",
  "env",
  "permissions",
  "enabledPlugins",
  "extraKnownMarketplaces",
  ...PROGRAM_KEYS,
  ...PROGRAM_OBJECT_KEYS,
]);
/** Environment variables that send traffic or code somewhere else: their value is shown. */
const REDIRECT_ENV = new Set(
  [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_VERTEX_BASE_URL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "BASH_ENV",
    "ENV",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "PATH",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "GIT_SSH_COMMAND",
  ].map((name) => name.toLowerCase()),
);
/** Header keys of an agent, skill or command that carry code or grants. */
const HEADER_KEYS = new Set(["hooks", "mcpServers", "allowed-tools", "allowedTools", "tools"]);

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON file of the project, or why not: missing is not an error; a link out, too big or not JSON is `unreadable`. */
async function readJson(
  root: string,
  name: string,
  unreadable: string[],
): Promise<Record<string, unknown> | null> {
  const file = join(root, name);
  try {
    if (!(await exists(file))) return null;
    const real = await realpath(file);
    if (!isInside(root, real)) throw new Error("leaves the project");
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_FILE) throw new Error("not a plain file of a sane size");
    const parsed: unknown = JSON.parse(await readFile(real, "utf8"));
    if (!isObject(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    unreadable.push(name);
    return null;
  }
}

/** The names inside a folder of the project (files without their extension, or folders), never their contents. */
async function names(root: string, dir: string, folders: boolean): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, prefix: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_ITEMS) return;
      if (entry.isDirectory()) {
        if (folders && depth === 0) out.push(entry.name);
        else if (!folders && depth < 3)
          await walk(join(at, entry.name), `${prefix}${entry.name}/`, depth + 1);
      } else if (!folders && entry.isFile() && entry.name.endsWith(".md")) {
        out.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };
  await walk(join(root, dir), "", 0);
  return out;
}

/**
 * The agent, skill and command files whose header (the `---` block) has hooks, servers or tool
 * grants, with those keys. Only the head of each file is read, and a link out of the project is not.
 */
async function headers(
  root: string,
  dir: string,
  skills: boolean,
  unreadable: string[],
): Promise<Array<{ file: string; keys: string[] }>> {
  const files: string[] = [];
  const walk = async (at: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_ITEMS) return;
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3) await walk(full, depth + 1);
      } else if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        (skills ? entry.name === "SKILL.md" : entry.name.endsWith(".md"))
      ) {
        files.push(full);
      }
    }
  };
  await walk(join(root, dir), 0);
  const out: Array<{ file: string; keys: string[] }> = [];
  for (const full of files) {
    const name = relative(root, full).split(sep).join("/");
    try {
      const real = await realpath(full);
      if (!isInside(root, real)) throw new Error("leaves the project");
      const info = await stat(real);
      if (!info.isFile() || info.size > MAX_FILE)
        throw new Error("not a plain file of a sane size");
      const text = await readFile(real, "utf8");
      const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
      const keys = [...head.matchAll(/^([A-Za-z][\w-]*)\s*:/gm)]
        .map((m) => m[1] as string)
        .filter((key) => HEADER_KEYS.has(key));
      if (keys.length > 0) out.push({ file: name, keys });
    } catch {
      // A link out of the project, a dangling one or a file too big is not read, and is said so.
      unreadable.push(name);
    }
  }
  return out;
}

/** What the project's own files would bring into a session: read, never run. */
export async function inspectProject(path: string): Promise<ProjectLoad> {
  const root = await realpath(resolve(path)).catch(() => resolve(path));
  const unreadable: string[] = [];
  const load: ProjectLoad = {
    path: root,
    hooks: [],
    mcpServers: [],
    envKeys: [],
    allowRules: [],
    defaultMode: null,
    agents: [],
    skills: [],
    commands: [],
    claudeMd: false,
    executables: [],
    redirects: [],
    plugins: [],
    otherKeys: [],
    extras: [],
    unreadable,
    omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
  };
  const shown = { hooks: 0 };
  const otherKeys = new Set<string>();
  for (const file of [".claude/settings.json", ".claude/settings.local.json"]) {
    const settings = await readJson(root, file, unreadable);
    if (!settings) continue;
    if (isObject(settings.hooks)) {
      for (const [event, groups] of Object.entries(settings.hooks)) {
        const commands = (Array.isArray(groups) ? groups : [])
          .flatMap((group) => (isObject(group) && Array.isArray(group.hooks) ? group.hooks : []))
          .flatMap((hook) =>
            isObject(hook) && typeof hook.command === "string" ? [show(hook.command)] : [],
          );
        const kept = commands.slice(0, Math.max(0, MAX_ITEMS - shown.hooks));
        load.omitted.hooks += commands.length - kept.length;
        shown.hooks += kept.length;
        if (kept.length > 0) load.hooks.push({ event, file, commands: kept });
      }
    }
    for (const [key, value] of Object.entries(settings)) {
      const command = PROGRAM_KEYS.has(key)
        ? value
        : PROGRAM_OBJECT_KEYS.has(key) && isObject(value)
          ? value.command
          : undefined;
      if (typeof command === "string") load.executables.push({ key, file, command: show(command) });
      if (!EXPLAINED_KEYS.has(key)) otherKeys.add(key);
    }
    for (const key of ["enabledPlugins", "extraKnownMarketplaces"]) {
      const value = settings[key];
      if (isObject(value)) load.plugins.push(...Object.keys(value));
    }
    if (isObject(settings.env)) {
      load.envKeys.push(...Object.keys(settings.env));
      for (const [key, value] of Object.entries(settings.env)) {
        if (REDIRECT_ENV.has(key.toLowerCase()) && typeof value === "string") {
          load.redirects.push({ key, file, value: show(value) });
        }
      }
    }
    if (isObject(settings.permissions)) {
      const { allow, defaultMode } = settings.permissions;
      if (Array.isArray(allow)) {
        load.allowRules.push(...allow.filter((r): r is string => typeof r === "string").map(show));
      }
      if (typeof defaultMode === "string") load.defaultMode = defaultMode;
    }
  }
  const mcp = await readJson(root, ".mcp.json", unreadable);
  if (mcp && isObject(mcp.mcpServers)) {
    const servers = Object.entries(mcp.mcpServers);
    load.omitted.mcpServers = Math.max(0, servers.length - MAX_ITEMS);
    for (const [name, server] of servers.slice(0, MAX_ITEMS)) {
      if (!isObject(server)) continue;
      const command =
        typeof server.command === "string"
          ? [server.command, ...(Array.isArray(server.args) ? server.args.map(String) : [])].join(
              " ",
            )
          : typeof server.url === "string"
            ? server.url
            : "";
      load.mcpServers.push({ name, file: ".mcp.json", command: show(command) });
    }
  }
  const keys = [...new Set(load.envKeys)].sort();
  load.omitted.envKeys = Math.max(0, keys.length - MAX_ITEMS);
  load.envKeys = keys.slice(0, MAX_ITEMS);
  load.omitted.allowRules = Math.max(0, load.allowRules.length - MAX_ITEMS);
  load.allowRules = load.allowRules.slice(0, MAX_ITEMS);
  load.otherKeys = [...otherKeys].sort();
  load.extras = [
    ...(await headers(root, ".claude/agents", false, unreadable)),
    ...(await headers(root, ".claude/skills", true, unreadable)),
    ...(await headers(root, ".claude/commands", false, unreadable)),
  ].slice(0, MAX_ITEMS);
  load.agents = await names(root, ".claude/agents", false);
  load.skills = await names(root, ".claude/skills", true);
  load.commands = await names(root, ".claude/commands", false);
  load.claudeMd = await exists(join(root, "CLAUDE.md"));
  return load;
}
