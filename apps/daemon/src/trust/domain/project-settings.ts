/**
 * What a project's settings files bring into a session, read from the JSON already parsed: the hooks,
 * servers, programs, environment names and permission rules the person is shown before trusting a
 * project (issue #196). No I/O: the files are read by `inspect.ts`.
 */

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

export const MAX_ITEMS = 100;
/** A command is shown whole up to this many characters; past it the cut says how much is left. */
const MAX_COMMAND = 4096;

/**
 * A command as written, every line: what runs once the project is trusted is what the person read.
 * Past the bound the text is cut with a count of the characters left out, never silently.
 */
export function show(text: string): string {
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

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
export function mcpCommand(server: Record<string, unknown>): string {
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
export function readSettings(
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
