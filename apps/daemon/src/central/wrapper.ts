import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import type { PersonaSubagents, ResolvedPersonaResult } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import type { Config } from "../config.ts";
import type { Exec } from "../exec.ts";
import { spawnExec } from "../exec.ts";
import { DaemonClient, daemonUrl } from "../mcp.ts";
import { type TelemetryTarget, wrapperTelemetryEnv } from "../telemetry/otlp-env.ts";
import { ulid } from "../ulid.ts";
import { whichOnPath } from "../which.ts";

/** The launch id an app terminal asks `flightdeckd claude` to use. */
export const TERMINAL_LAUNCH_VAR = "FLIGHTDECK_TERMINAL_LAUNCH_ID";

/** Where the daemon publishes its receptor's URL, inside `dataDir`. */
export const RECEPTOR_FILE = "receptor.json";

/** Where the daemon publishes its OTLP receiver's URL, inside `dataDir` (phase 23). */
export const TELEMETRY_FILE = "telemetry.json";

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
 * Where the daemon's OTLP receiver is, with the token of its own; `null` when the daemon has
 * not published one (it is down, or telemetry is off) or no token exists.
 */
async function telemetryTarget(config: Config): Promise<TelemetryTarget | null> {
  const file = join(config.dataDir, TELEMETRY_FILE);
  const token = config.telemetry.token;
  if (!token) return null;
  try {
    const { url } = JSON.parse(await readFile(file, "utf8")) as { url?: unknown };
    return typeof url === "string" ? { url, token } : null;
  } catch {
    return null;
  }
}

/**
 * The characters a path may hold for claude to read it back whatever starts it (#936): a `.cmd`
 * shim has its command line re-parsed by cmd.exe (`&`, `^`, `%`), and an accent can be lost in the
 * console's code page. A space is out too: the shim's quoting is not something to rely on.
 */
export const PLAIN_PATH = /^[A-Za-z0-9\\/:._-]+$/;

/** The local daemon's receptor URL, if it answers within `timeoutMs`. */
export async function liveReceptor(dataDir: string, timeoutMs: number): Promise<string | null> {
  const file = join(dataDir, RECEPTOR_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  // A file the daemon is writing right now is no receptor yet.
  let url: string;
  try {
    ({ url } = JSON.parse(text) as { url: string });
  } catch {
    return null;
  }
  const healthy = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) }).then(
    (response) => response.ok,
    () => false,
  );
  return healthy ? url : null;
}

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
const passed = (args: string[], flag: string) =>
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

export interface RunClaudeOptions {
  args: string[];
  config: Config;
  /** The folder claude runs in: the project whose personas count. The process's when absent. */
  cwd?: string;
  env: Record<string, string | undefined>;
  /** This daemon's command line, which `claude` runs as the channel's MCP server. */
  self: string[];
  log: { error(message: string): void };
  timeoutMs: number;
  /** The platform claude runs on; the process's when absent. Injected in tests. */
  platform?: NodeJS.Platform;
  /** Runs `icacls` for the folder that holds the channel config on Windows; the real one when absent. */
  exec?: Exec;
}

/** The persona the launch asked for; "failed" (after saying why) when it cannot be had. */
async function requestedPersona(
  opts: RunClaudeOptions,
  personaId: string,
): Promise<ResolvedPersonaResult | "failed"> {
  try {
    return await fetchPersona(opts.config, personaId, opts.cwd ?? process.cwd());
  } catch (error) {
    opts.log.error(`flightdeckd: persona ${personaId}: ${(error as Error).message}`);
    return "failed";
  }
}

/** What is said when the channel config cannot be written: the session opens with neither flag. */
const CHANNEL_NOTICE =
  "flightdeckd: could not write the channel config; opening claude without the channel (the app will not be able to send messages)";

/** A user name icacls can be given as one principal: no wildcard, SID marker, separator or list. */
const ACCOUNT = /^[^\p{Cc}\\/:*?"<>|;,=+[\]]+$/u;

/** A base folder on a local drive: no network share, no relative path, no `..`. */
const localBase = (base: string) =>
  PLAIN_PATH.test(base) &&
  win32.isAbsolute(base) &&
  !/^[\\/]{2}/.test(base) &&
  !/(^|[\\/])\.\.($|[\\/])/.test(base);

/** Takes a folder we made away again, if it is empty; one with anything in it is left as it is. */
async function removeFolder(folder: string) {
  await Promise.allSettled([rmdir(folder)]);
}

/**
 * A folder only `user` can open, made for this launch, with a plain path (#936). The folder must be
 * new (one already there is not ours and is left alone), is restricted before anything goes into
 * it, and must still be empty afterwards, so no one's file is in it when the token goes in.
 * `false` when it cannot be made or restricted: it is then taken away, and the caller goes on
 * without the channel.
 */
async function restrictedFolder(opts: RunClaudeOptions, folder: string, user: string) {
  const [made] = await Promise.allSettled([mkdir(folder, { mode: 0o700 })]);
  if (made.status !== "fulfilled") return false;
  let restricted = false;
  try {
    const system = win32.join(
      opts.env.SystemRoot ?? opts.env.windir ?? String.raw`C:\Windows`,
      "System32",
    );
    const acl = [win32.join(system, "icacls.exe"), folder, "/inheritance:r", "/grant:r"];
    const done = await (opts.exec ?? spawnExec)([...acl, `${user}:(OI)(CI)F`]);
    restricted = done.code === 0 && (await readdir(folder)).length === 0;
  } catch {
    restricted = false;
  }
  if (!restricted) await removeFolder(folder);
  return restricted;
}

/**
 * Where the files claude is given by path go (#936). `own` is a private folder made for this launch
 * when the data folder's path is not one claude reads back reliably (Windows, a `.cmd` shim or an
 * accent); `null` when the data folder's own is fine. The whole answer is `null` when a plain folder
 * was needed and could not be had.
 */
type LaunchFolder = { own: string | null };

/** Where the files go: the data folder, or on Windows a plain private folder when that path is not plain. */
async function launchFolder(
  opts: RunClaudeOptions,
  launchId: string,
): Promise<LaunchFolder | null> {
  const windows = (opts.platform ?? process.platform) === "win32";
  // The longest name any of the files has: they all share the data folder's prefix.
  const probe = join(opts.config.dataDir, "personas", `${launchId}-agents.json`);
  if (!windows || PLAIN_PATH.test(probe)) return { own: null };
  const { ProgramData, PROGRAMDATA, PUBLIC, USERDOMAIN, USERNAME } = opts.env;
  // The account is the process's own, from its environment: a name that could mean anything else is no account.
  const named = (name: string | undefined) => name !== undefined && ACCOUNT.test(name);
  if (!USERNAME?.trim() || !named(USERNAME) || (USERDOMAIN && !named(USERDOMAIN))) return null;
  const user = USERDOMAIN ? `${USERDOMAIN}\\${USERNAME}` : USERNAME;
  for (const base of [ProgramData ?? PROGRAMDATA, PUBLIC]) {
    const folder = base && localBase(base) ? join(base, `Flightdeck-${launchId}`) : null;
    if (folder && (await restrictedFolder(opts, folder, user))) return { own: folder };
  }
  return null;
}

/**
 * Writes the MCP config that gives the session the Flightdeck channel; returns its path, or `null`
 * when it cannot be written: the session then opens with neither flag, since `--mcp-config` of a
 * file that is not there and a channel named after a server that is not configured make claude
 * print a warning for a channel that does nothing (#936). The path is in `files` before it is
 * written, so a half-written config is taken away with the rest.
 */
async function writeChannelConfig(
  opts: RunClaudeOptions,
  launchId: string,
  url: string,
  token: string,
  where: LaunchFolder | null,
  files: string[],
): Promise<string | null> {
  const [command, ...rest] = opts.self;
  const args = [...rest, "channel", "--launch", launchId, "--url", url, "--token", token];
  if (where) {
    const dir = where.own ?? join(opts.config.dataDir, "channels");
    const path = join(dir, `${launchId}.json`);
    files.push(path);
    try {
      await mkdir(dir, { recursive: true });
      const config = JSON.stringify({ mcpServers: { flightdeck: { command, args } } });
      // In the plain folder the file must be new: one already there is not ours.
      await writeFile(path, config, { mode: 0o600, flag: where.own ? "wx" : "w" });
      return path;
    } catch {
      // Said below, and the half-written file goes with the others.
    }
  }
  opts.log.error(CHANNEL_NOTICE);
  return null;
}

/** The badge only (never the body): the SessionStart hook forwards it to the central. */
function personaBadge(persona: ResolvedPersonaResult | null): Record<string, string> {
  if (!persona) return {};
  const { id, name, icon } = persona.persona;
  return { FLIGHTDECK_PERSONA: JSON.stringify({ id, name, icon }) };
}

/** The launch the app's terminal named, when it is a valid id; a new one otherwise. */
const launchIdOf = (requested: string | undefined): string =>
  requested && /^[0-9A-Z]{26}$/.test(requested) ? requested : ulid();

/**
 * The persona subagents as `--agents`: from a file in print mode, inline in an interactive one;
 * none when the user passed their own `--agents` or the daemon has no personas for the folder.
 */
async function agentArgs(
  opts: RunClaudeOptions,
  launch: { claude: string; args: string[]; print: boolean; launchId: string },
  write: (name: string, content: string) => Promise<string>,
): Promise<string[]> {
  // The user's own --agents wins, and without the daemon claude opens just the same.
  const agents = passed(launch.args, "--agents")
    ? null
    : await fetchAgents(opts.config, opts.cwd ?? process.cwd());
  if (!agents || Object.keys(agents).length === 0) return [];
  const json = JSON.stringify(agents);
  // Only print mode reads --agents from a file.
  if (launch.print) return ["--agents", await write(`${launch.launchId}-agents.json`, json)];
  const interactive = interactiveAgents({
    json,
    claude: launch.claude,
    platform: opts.platform ?? process.platform,
  });
  if (interactive.notice) opts.log.error(interactive.notice);
  return interactive.args;
}

/** Deletes the files of a launch and its folder, when it made one. */
async function removeLaunch(files: string[], folder?: Promise<LaunchFolder | null>): Promise<void> {
  await removeAll(files);
  const own = folder ? ((await folder)?.own ?? null) : null;
  if (own) await removeFolder(own);
}

/**
 * The system prompt arguments of a launch: the persona's role and the knowledge index, in one file.
 * The user's own system prompt wins: claude takes one, so the index is not put beside it.
 */
async function systemPromptArgs(
  opts: RunClaudeOptions,
  args: string[],
  persona: ResolvedPersonaResult | null,
  name: string,
  write: (name: string, content: string) => Promise<string>,
): Promise<string[]> {
  const own = passed(args, "--append-system-prompt") || passed(args, "--append-system-prompt-file");
  const knowledge = own ? null : await fetchKnowledge(opts.config, opts.cwd ?? process.cwd());
  if (persona) {
    const body = knowledge ? `${persona.persona.body}\n\n${knowledge}` : persona.persona.body;
    return personaArgs(persona.persona, await write(name, body), args);
  }
  return knowledge ? ["--append-system-prompt-file", await write(name, knowledge)] : [];
}

/** Deletes the files that exist; one that cannot be taken away (or is not under a folder) is passed over. */
async function removeAll(paths: string[]): Promise<void> {
  await inSequence(paths, async (path) => {
    await Promise.allSettled([rm(path, { force: true })]);
  });
}

/**
 * `flightdeckd claude [args]`: the real `claude` in this terminal (stdio inherited, exit code
 * passed through) with the Flightdeck channel, so the app can send messages to the session.
 * Without the daemon it still opens `claude`, without the channel; with `-p`/`--print`, plain.
 */
export async function runClaude(opts: RunClaudeOptions): Promise<number> {
  const claude = opts.config.claude?.executablePath ?? whichOnPath("claude");
  if (!claude) {
    opts.log.error("flightdeckd: claude not found on the PATH (nor in claude.executablePath)");
    return 1;
  }
  // A terminal of the app ("Claude aqui") names the launch it started: the session it opens is
  // then the one that terminal shows. A dedicated variable, because FLIGHTDECK_LAUNCH_ID is in the
  // environment of every claude we start, and a nested `flightdeckd claude` would reuse it.
  // A persona of an outer claude is not this one's: only `--persona` below sets it.
  const { [TERMINAL_LAUNCH_VAR]: requested, FLIGHTDECK_PERSONA: _outer, ...env } = opts.env;
  const launchId = launchIdOf(requested);
  // Print mode ignores development channels: plain claude, no channel, no warning.
  const { id: personaId, rest: args, broken } = takePersonaFlag(opts.args);
  if (broken) {
    opts.log.error("flightdeckd: --persona needs the persona id");
    return 1;
  }
  // Asked for on purpose, so a persona that cannot be had stops here: no claude without the role.
  const persona = personaId ? await requestedPersona(opts, personaId) : null;
  if (persona === "failed") return 1;
  const print = args.includes("-p") || args.includes("--print");
  const background = args.includes("--bg") || args.includes("--background");
  const url = print ? null : await liveReceptor(opts.config.dataDir, opts.timeoutMs);
  const token = opts.config.hooks.token;
  // The body and, in print mode, the subagents travel in files that only live while claude runs (nine bodies of
  // 8 KB do not fit on a Windows command line).
  const files: string[] = [];
  // Made when the first file needs it, once for the launch: the channel config and these files share it.
  const made: { folder?: Promise<LaunchFolder | null> } = {};
  const where = () => {
    made.folder ??= launchFolder(opts, launchId);
    return made.folder;
  };
  const write = async (name: string, content: string) => {
    const own = (await where())?.own ?? null;
    const dir = own ?? join(opts.config.dataDir, "personas");
    // Only the owner reads them: a persona's body and the library's index are not for other users.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, name);
    files.push(file);
    await writeFile(file, content, { mode: 0o600, flag: own ? "wx" : "w" });
    return file;
  };
  const added: string[] = [];
  try {
    const channel =
      url && token
        ? await writeChannelConfig(opts, launchId, url, token, await where(), files)
        : null;
    // Without a receptor or a token: the daemon is down. A config that failed to write said so itself.
    if (!channel && !print && !(url && token)) {
      opts.log.error(
        "flightdeckd: the Flightdeck daemon is down; opening claude without the channel (the app will not be able to send messages)",
      );
    }
    added.push(...(await systemPromptArgs(opts, args, persona, `${launchId}.md`, write)));
    added.push(...(await agentArgs(opts, { claude, args, print, launchId }, write)));
    const proc = Bun.spawn(
      buildClaudeLaunch({
        claude,
        args: [...added, ...args],
        mcpConfigPath: channel,
      }),
      {
        env: {
          ...env,
          // Print mode is not a session of a terminal: no exporter.
          ...wrapperTelemetryEnv(env, print ? null : await telemetryTarget(opts.config)),
          FLIGHTDECK_LAUNCH_ID: launchId,
          // The badge only (never the body): the SessionStart hook forwards it to the central.
          ...personaBadge(persona),
        },
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    return await proc.exited;
  } finally {
    // `claude --bg` returns at once and the session goes on: its channel config and persona
    // files are still read, so they stay (a few small files per background session).
    if (!background) await removeLaunch(files, made.folder);
  }
}

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
export function isWindowsShim(path: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(path);
}

/**
 * Interactive claude takes `--agents` as inline JSON only, and a Windows command line holds
 * about 32 K characters (quotes get escaped, so the JSON can grow); past this the agents are dropped.
 */
export const INLINE_AGENTS_MAX = 20_000;

/** The project's personas as agents, from the daemon of this host; `null` when it cannot be reached. */
async function fetchAgents(
  config: Config,
  cwd: string,
): Promise<PersonaSubagents["agents"] | null> {
  try {
    const daemon = await DaemonClient.connect(
      daemonUrl(config),
      config.token,
      "flightdeckd-claude",
    );
    try {
      return (await daemon.call("personas.subagents", { projectPath: cwd })).agents;
    } finally {
      daemon.close();
    }
  } catch {
    return null;
  }
}

/**
 * The index of the project's library for the system prompt (issue #76), from the daemon of this
 * host, which gives it only to a trusted project that has not switched it off; `null` when there
 * is none or the daemon cannot be reached (claude opens just the same).
 */
async function fetchKnowledge(config: Config, cwd: string): Promise<string | null> {
  try {
    const daemon = await DaemonClient.connect(
      daemonUrl(config),
      config.token,
      "flightdeckd-claude",
    );
    try {
      const { text } = await daemon.call("knowledge.index", { path: cwd });
      return text === "" ? null : text;
    } finally {
      daemon.close();
    }
  } catch {
    return null;
  }
}

/** Asks the daemon of this host for the persona, which applies the project's, the trust and the pack. */
async function fetchPersona(
  config: Config,
  id: string,
  cwd: string,
): Promise<ResolvedPersonaResult> {
  const daemon = await DaemonClient.connect(
    daemonUrl(config),
    config.token,
    "flightdeckd-claude",
  ).catch(() => {
    throw new Error("the Flightdeck daemon is down");
  });
  try {
    return await daemon.call("personas.resolve", { ref: { id }, projectPath: cwd });
  } finally {
    daemon.close();
  }
}
