import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PersonaSubagents, ResolvedPersonaResult } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import type { Config } from "../config.ts";
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

/** The local daemon's receptor URL, if it answers within `timeoutMs`. */
async function liveReceptor(dataDir: string, timeoutMs: number): Promise<string | null> {
  const file = join(dataDir, RECEPTOR_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  const { url } = JSON.parse(text) as { url: string };
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

/** Writes the MCP config that gives the session the Flightdeck channel; returns its path. */
async function writeChannelConfig(
  opts: RunClaudeOptions,
  launchId: string,
  url: string,
  token: string,
): Promise<string> {
  const dir = join(opts.config.dataDir, "channels");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${launchId}.json`);
  const [command, ...rest] = opts.self;
  const args = [...rest, "channel", "--launch", launchId, "--url", url, "--token", token];
  await writeFile(path, JSON.stringify({ mcpServers: { flightdeck: { command, args } } }));
  return path;
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

/** Deletes the files that exist (a null path is skipped). */
async function removeAll(paths: Array<string | null>): Promise<void> {
  await inSequence(paths, async (path) => {
    if (path) await rm(path, { force: true });
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
    opts.log.error("flightdeckd: claude não encontrado no PATH (nem em claude.executablePath)");
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
    opts.log.error("flightdeckd: --persona pede o id da persona");
    return 1;
  }
  // Asked for on purpose, so a persona that cannot be had stops here: no claude without the role.
  const persona = personaId ? await requestedPersona(opts, personaId) : null;
  if (persona === "failed") return 1;
  const print = args.includes("-p") || args.includes("--print");
  const background = args.includes("--bg") || args.includes("--background");
  const url = print ? null : await liveReceptor(opts.config.dataDir, opts.timeoutMs);
  const token = opts.config.hooks.token;
  const mcpConfigPath = url && token ? await writeChannelConfig(opts, launchId, url, token) : null;
  if (!mcpConfigPath && !print) {
    opts.log.error(
      "flightdeckd: daemon do Flightdeck fora do ar; abrindo o claude sem o canal (o app não poderá mandar mensagens)",
    );
  }
  // The body and, in print mode, the subagents travel in files that only live while claude runs (nine bodies of
  // 8 KB do not fit on a Windows command line).
  const dir = join(opts.config.dataDir, "personas");
  const files: string[] = [];
  const write = async (name: string, content: string) => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, name);
    await writeFile(file, content);
    files.push(file);
    return file;
  };
  const added: string[] = [];
  if (persona) {
    added.push(
      ...personaArgs(persona.persona, await write(`${launchId}.md`, persona.persona.body), args),
    );
  }
  added.push(...(await agentArgs(opts, { claude, args, print, launchId }, write)));
  try {
    const proc = Bun.spawn(
      buildClaudeLaunch({
        claude,
        args: [...added, ...args],
        mcpConfigPath,
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
    if (!background) await removeAll([mcpConfigPath, ...files]);
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
    throw new Error("o daemon do Flightdeck está fora do ar");
  });
  try {
    return await daemon.call("personas.resolve", { ref: { id }, projectPath: cwd });
  } finally {
    daemon.close();
  }
}
