import type { Dirent } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isInside, parseJsonText } from "../kernel/index.ts";

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
  /** What the project's settings deny (#75): rules, never a value of the settings. */
  denyRules: string[];
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
  omitted: {
    hooks: number;
    mcpServers: number;
    allowRules: number;
    denyRules: number;
    envKeys: number;
  };
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
    const parsed: unknown = parseJsonText(await readFile(real, "utf8"));
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
          await walk(join(at, entry.name), `${prefix}${entry.name}/`, depth + 1); // NOSONAR: depth first in name order, up to MAX_ITEMS: the walk shares the list it fills
      } else if (!folders && entry.isFile() && entry.name.endsWith(".md")) {
        out.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };
  await walk(join(root, dir), "", 0);
  return out;
}

/** What the walk does with one entry: go into a folder, keep a header file, say why it is skipped, or ignore it. */
type Step = { kind: "dir" | "file" | "ignore" } | { kind: "skip"; why: string };

function stepFor(entry: Dirent, shown: string, depth: number, skills: boolean): Step {
  if (entry.isDirectory()) {
    return depth < 3 ? { kind: "dir" } : { kind: "skip", why: `${shown} (too deep, not scanned)` };
  }
  if (entry.isSymbolicLink() && !entry.name.endsWith(".md")) {
    return { kind: "skip", why: `${shown} (a link, not followed, not scanned)` };
  }
  const named = skills ? entry.name === "SKILL.md" : entry.name.endsWith(".md");
  return (entry.isFile() || entry.isSymbolicLink()) && named
    ? { kind: "file" }
    : { kind: "ignore" };
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
  // Whatever the scan leaves unread is said, so a header past a cap cannot pass for a clean project.
  const skipped = new Set<string>();
  const walk = async (at: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_ITEMS) {
        skipped.add(`${dir} (more than ${MAX_ITEMS} files, the rest not scanned)`);
        return;
      }
      const full = join(at, entry.name);
      const step = stepFor(entry, relative(root, full).split(sep).join("/"), depth, skills);
      if (step.kind === "dir")
        await walk(full, depth + 1); // NOSONAR: depth first in name order: the walk shares the files and skipped lists
      else if (step.kind === "file") files.push(full);
      else if (step.kind === "skip") skipped.add(step.why);
    }
  };
  await walk(join(root, dir), 0);
  unreadable.push(...skipped);
  const out: Array<{ file: string; keys: string[] }> = [];
  for (const full of files) {
    const name = relative(root, full).split(sep).join("/");
    try {
      const real = await realpath(full); // NOSONAR: each step needs the answer of the one before (real path, then size, then text)
      if (!isInside(root, real)) throw new Error("leaves the project");
      const info = await stat(real); // NOSONAR: each step needs the answer of the one before (real path, then size, then text)
      if (!info.isFile() || info.size > MAX_FILE)
        throw new Error("not a plain file of a sane size");
      const text = await readFile(real, "utf8"); // NOSONAR: each step needs the answer of the one before (real path, then size, then text)
      const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
      const keys = [...head.matchAll(/^["']?([A-Za-z][\w-]*)["']?[ \t]*:/gm)]
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

/** The program a setting names, if its value is one: a command string, or an object with one. */
function programOf(key: string, value: unknown): string | undefined {
  if (PROGRAM_KEYS.has(key)) return typeof value === "string" ? value : undefined;
  if (PROGRAM_OBJECT_KEYS.has(key) && isObject(value) && typeof value.command === "string") {
    return value.command;
  }
  return undefined;
}

/** The commands of the hook groups of one event, as written. */
function hookCommands(groups: unknown): string[] {
  return (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (isObject(group) && Array.isArray(group.hooks) ? group.hooks : []))
    .flatMap((hook) =>
      isObject(hook) && typeof hook.command === "string" ? [show(hook.command)] : [],
    );
}

/** What starts an MCP server: its command with its arguments, or its address. */
function mcpCommand(server: Record<string, unknown>): string {
  if (typeof server.command === "string") {
    const args = Array.isArray(server.args) ? server.args.map(String) : [];
    return [server.command, ...args].join(" ");
  }
  return typeof server.url === "string" ? server.url : "";
}

/** The commands of the hook events of one settings file, within the cap shared by all files. */
function readHooks(
  load: ProjectLoad,
  hooks: unknown,
  file: string,
  shown: { hooks: number },
): void {
  if (!isObject(hooks)) return;
  for (const [event, groups] of Object.entries(hooks)) {
    const commands = hookCommands(groups);
    const kept = commands.slice(0, Math.max(0, MAX_ITEMS - shown.hooks));
    load.omitted.hooks += commands.length - kept.length;
    shown.hooks += kept.length;
    if (kept.length > 0) load.hooks.push({ event, file, commands: kept });
  }
}

/** The names of the environment variables set, and those that redirect where a tool talks to. */
function readEnv(load: ProjectLoad, env: unknown, file: string): void {
  if (!isObject(env)) return;
  load.envKeys.push(...Object.keys(env));
  for (const [key, value] of Object.entries(env)) {
    if (REDIRECT_ENV.has(key.toLowerCase()) && typeof value === "string") {
      load.redirects.push({ key, file, value: show(value) });
    }
  }
}

/** The allow and deny rules, and the default mode. */
function readPermissions(load: ProjectLoad, permissions: unknown): void {
  if (!isObject(permissions)) return;
  const { allow, deny, defaultMode } = permissions;
  const rules = (list: unknown) =>
    Array.isArray(list) ? list.filter((r): r is string => typeof r === "string").map(show) : [];
  load.allowRules.push(...rules(allow));
  load.denyRules.push(...rules(deny));
  if (typeof defaultMode === "string") load.defaultMode = defaultMode;
}

/** What one settings file adds to the listing. */
function readSettings(
  load: ProjectLoad,
  settings: Record<string, unknown>,
  file: string,
  shown: { hooks: number },
  otherKeys: Set<string>,
): void {
  readHooks(load, settings.hooks, file, shown);
  for (const [key, value] of Object.entries(settings)) {
    const command = programOf(key, value);
    if (command !== undefined) load.executables.push({ key, file, command: show(command) });
    if (!EXPLAINED_KEYS.has(key)) otherKeys.add(key);
  }
  for (const key of ["enabledPlugins", "extraKnownMarketplaces"]) {
    const value = settings[key];
    if (isObject(value)) load.plugins.push(...Object.keys(value));
  }
  readEnv(load, settings.env, file);
  readPermissions(load, settings.permissions);
}

/** What the project's own files would bring into a session: read, never run. */
/** Code-unit order, the same on every host and locale. */
const byCode = (a: string, b: string) => (a < b ? -1 : Number(a > b));

export async function inspectProject(path: string): Promise<ProjectLoad> {
  const root = await realpath(resolve(path)).catch(() => resolve(path));
  const unreadable: string[] = [];
  const load: ProjectLoad = {
    path: root,
    hooks: [],
    mcpServers: [],
    envKeys: [],
    allowRules: [],
    denyRules: [],
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
    omitted: { hooks: 0, mcpServers: 0, allowRules: 0, denyRules: 0, envKeys: 0 },
  };
  const shown = { hooks: 0 };
  const otherKeys = new Set<string>();
  for (const file of [".claude/settings.json", ".claude/settings.local.json"]) {
    const settings = await readJson(root, file, unreadable); // NOSONAR: settings.json, then settings.local.json: both fill the same counters and lists, in that order
    if (settings) readSettings(load, settings, file, shown, otherKeys);
  }
  const mcp = await readJson(root, ".mcp.json", unreadable);
  if (mcp && isObject(mcp.mcpServers)) {
    const servers = Object.entries(mcp.mcpServers);
    load.omitted.mcpServers = Math.max(0, servers.length - MAX_ITEMS);
    for (const [name, server] of servers.slice(0, MAX_ITEMS)) {
      if (!isObject(server)) continue;
      const command = mcpCommand(server);
      load.mcpServers.push({ name, file: ".mcp.json", command: show(command) });
    }
  }
  const keys = [...new Set(load.envKeys)].sort(byCode);
  load.omitted.envKeys = Math.max(0, keys.length - MAX_ITEMS);
  load.envKeys = keys.slice(0, MAX_ITEMS);
  load.omitted.allowRules = Math.max(0, load.allowRules.length - MAX_ITEMS);
  load.allowRules = load.allowRules.slice(0, MAX_ITEMS);
  load.omitted.denyRules = Math.max(0, load.denyRules.length - MAX_ITEMS);
  load.denyRules = load.denyRules.slice(0, MAX_ITEMS);
  load.otherKeys = [...otherKeys].sort(byCode);
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
