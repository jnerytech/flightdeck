import { win32 } from "node:path";
import type { ResolvedPersonaResult } from "@flightdeck/protocol";

/**
 * The `claude` command line: our `--mcp-config` and development channel first (an option right
 * after the variadic `--mcp-config` ends it), then the user's arguments untouched. Without a
 * channel config, only the user's.
 */
export function buildClaudeLaunch(opts: {
  claude: string;
  args: string[];
  mcpConfigPath: string | null;
}): string[] {
  const channel = opts.mcpConfigPath
    ? [
        "--mcp-config",
        opts.mcpConfigPath,
        "--dangerously-load-development-channels",
        "server:flightdeck",
      ]
    : [];
  return [opts.claude, ...channel, ...opts.args];
}

/**
 * The characters a path may hold for claude to read it back whatever starts it (#936): a `.cmd`
 * shim has its command line re-parsed by cmd.exe (`&`, `^`, `%`), and an accent can be lost in the
 * console's code page. A space is out too: the shim's quoting is not something to rely on.
 */
export const PLAIN_PATH = /^[A-Za-z0-9\\/:._-]+$/;

/**
 * `--persona <id>` (or `--persona=<id>`) in the first place: the persona to open claude in. Past
 * the first argument it is the user's own text for claude and is left alone.
 */
export function takePersonaFlag(args: string[]): {
  id: string | null;
  rest: string[];
  broken: boolean;
} {
  const first = args[0];
  if (first === "--persona") {
    const id = args[1];
    return id === undefined || id.startsWith("-")
      ? { id: null, rest: args, broken: true }
      : { id, rest: args.slice(2), broken: false };
  }
  if (first?.startsWith("--persona=")) {
    const id = first.slice("--persona=".length);
    return id === ""
      ? { id: null, rest: args, broken: true }
      : { id, rest: args.slice(1), broken: false };
  }
  return { id: null, rest: args, broken: false };
}

/** Whether the user already passed `flag` (as `--flag value` or `--flag=value`). */
export const passed = (args: string[], flag: string) =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

/**
 * The claude arguments a persona adds. The user's own always win: what they passed is not
 * repeated. `--permission-mode` only goes when the persona asks for `plan`, the most restrictive,
 * because the session's real mode may come from the user's settings and cannot be seen from here.
 */
export function personaArgs(
  persona: ResolvedPersonaResult["persona"],
  file: string,
  user: string[],
): string[] {
  const out = ["--append-system-prompt-file", file];
  if (persona.model && !passed(user, "--model")) out.push("--model", persona.model);
  if (persona.effort && !passed(user, "--effort")) out.push("--effort", persona.effort);
  // `--tools` sets the available tools, so it only restricts; --allowedTools would pre-approve.
  if (persona.tools && !passed(user, "--tools")) out.push(`--tools=${persona.tools.join(",")}`);
  if (persona.permissionMode === "plan" && !passed(user, "--permission-mode")) {
    out.push("--permission-mode", "plan");
  }
  return out;
}

/**
 * The `--permission-mode` a launch adds (#3427): bypass, the host's default, while its switch is on
 * and the host default is bypass. Nothing is added when the person (or a persona) already chose a
 * mode, and under root, where claude refuses bypass: the launch then opens in claude's own mode and
 * says so. `IS_SANDBOX` is never set to get around that refusal.
 */
export function bypassArgs(opts: {
  allowed: boolean;
  byDefault: string;
  given: string[];
  root: boolean;
  /** The mode the persona asks for, if any: one stricter than bypass is kept. */
  personaMode?: string | null;
}): { args: string[]; notice: string | null } {
  const none = { args: [], notice: null };
  if (!opts.allowed || opts.byDefault !== "bypassPermissions") return none;
  if (
    passed(opts.given, "--permission-mode") ||
    passed(opts.given, "--dangerously-skip-permissions")
  )
    return none;
  if (opts.root) {
    return {
      args: [],
      notice:
        "flightdeckd: this host's default is bypass permissions, but claude refuses it as root; opening claude in its own default mode",
    };
  }
  return { args: ["--permission-mode", "bypassPermissions"], notice: null };
}

/** The folder name a session is named after: the git toplevel's when there is one, else the launch folder's. */
export function repoFolder(cwd: string, toplevel: string | null): string {
  const trimmed = (toplevel ?? cwd).replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/** What a session is named after is a folder's name: no control or invisible-format character may reach the terminal title. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;

/** Flags that name a session or point at one that already has its name (renaming it is not ours to do). */
const NAMED = ["-n", "--name", "-r", "--resume", "-c", "--continue"];

/**
 * The `--name` a launch adds: `<repo>-<persona>`, or `<repo>` without a persona, the same for the
 * same folder and persona. Nothing is added when the person named the session or resumes one, or
 * when a Windows shim would have cmd.exe re-parse a name that is not plain (`a & calc`, #936).
 */
export function nameArgs(opts: {
  repo: string;
  persona: string | null;
  user: string[];
  claude: string;
  platform: NodeJS.Platform;
}): string[] {
  if (NAMED.some((flag) => passed(opts.user, flag))) return [];
  const repo = opts.repo.replace(UNPRINTABLE, "").trim();
  if (repo === "") return [];
  const name = opts.persona === null ? repo : `${repo}-${opts.persona}`;
  if (isWindowsShim(opts.claude, opts.platform) && !/^[A-Za-z0-9._-]+$/.test(name)) return [];
  // One argument: a folder called `--x` is then a value, never a flag.
  return [`--name=${name}`];
}

/** A user name icacls can be given as one principal: no wildcard, SID marker, separator or list. */
export const ACCOUNT = /^[^\p{Cc}\\/:*?"<>|;,=+[\]]+$/u;

/** A base folder on a local drive: no network share, no relative path, no `..`. */
export const localBase = (base: string) =>
  PLAIN_PATH.test(base) &&
  win32.isAbsolute(base) &&
  !/^[\\/]{2}/.test(base) &&
  !/(^|[\\/])\.\.($|[\\/])/.test(base);

/**
 * The `--agents` of an interactive claude: its arguments and, when they are left out, why. Left
 * out for a Windows shim (cmd.exe mangles the JSON) and for a JSON too long for the command line.
 */
export function interactiveAgents(opts: {
  json: string;
  claude: string;
  platform: NodeJS.Platform;
}): { args: string[]; notice: string | null } {
  if (isWindowsShim(opts.claude, opts.platform)) {
    return {
      args: [],
      notice:
        "flightdeckd: a claude.cmd or claude.bat shim cannot take the persona subagents on its command line (cmd.exe mangles the JSON); opening without --agents (a native claude.exe can)",
    };
  }
  if (opts.json.length > INLINE_AGENTS_MAX) {
    return {
      args: [],
      notice: `flightdeckd: the persona subagents (${opts.json.length} characters) do not fit on the command line of an interactive claude; opening without --agents`,
    };
  }
  return { args: ["--agents", opts.json], notice: null };
}

/**
 * A `.cmd` or `.bat` file on Windows (the npm install of claude is one). Windows runs it through
 * cmd.exe, which re-parses the command line and mangles a JSON argument; a native `claude.exe`
 * gets the line as it is.
 */
function isWindowsShim(path: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(path);
}

/**
 * Interactive claude takes `--agents` as inline JSON only, and a Windows command line holds
 * about 32 K characters (quotes get escaped, so the JSON can grow); past this the agents are dropped.
 * The pack alone is about 21 000 characters (14 personas, issue #1961); the rest is room for the
 * person's own, with about 4 000 left for the escaped quotes and the other arguments.
 */
export const INLINE_AGENTS_MAX = 28_000;
