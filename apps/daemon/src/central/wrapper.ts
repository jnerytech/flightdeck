import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import type { PersonaSubagents, ResolvedPersonaResult } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { z } from "zod";
import type { Config } from "../config.ts";
import { DaemonClient, daemonUrl } from "../daemon-client/index.ts";
import {
  type Exec,
  type Logger,
  parseJsonOr,
  spawnExec,
  ulid,
  whichOnPath,
} from "../kernel/index.ts";
import { type TelemetryTarget, wrapperTelemetryEnv } from "../telemetry/index.ts";
import { launchClaude } from "./adapters/claude-launch.ts";
import {
  ACCOUNT,
  buildClaudeLaunch,
  interactiveAgents,
  localBase,
  PLAIN_PATH,
  passed,
  personaArgs,
  takePersonaFlag,
} from "./domain/claude-launch-args.ts";

/** What the daemon publishes about the receiver it runs: where it listens. */
const Published = z.object({ url: z.string() });

/** The launch id an app terminal asks `flightdeckd claude` to use. */
export const TERMINAL_LAUNCH_VAR = "FLIGHTDECK_TERMINAL_LAUNCH_ID";

/** Where the daemon publishes its receptor's URL, inside `dataDir`. */
export const RECEPTOR_FILE = "receptor.json";

/** Where the daemon publishes its OTLP receiver's URL, inside `dataDir` (phase 23). */
export const TELEMETRY_FILE = "telemetry.json";

/**
 * Where the daemon's OTLP receiver is, with the token of its own; `null` when the daemon has
 * not published one (it is down, or telemetry is off) or no token exists.
 */
async function telemetryTarget(config: Config): Promise<TelemetryTarget | null> {
  const file = join(config.dataDir, TELEMETRY_FILE);
  const token = config.telemetry.token;
  if (!token) return null;
  try {
    const url = parseJsonOr(Published, await readFile(file, "utf8"), null)?.url;
    return url === undefined ? null : { url, token };
  } catch {
    return null;
  }
}

/** The local daemon's receptor URL, if it answers within `timeoutMs`. */
export async function liveReceptor(dataDir: string, timeoutMs: number): Promise<string | null> {
  const file = join(dataDir, RECEPTOR_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  // A file the daemon is writing right now is no receptor yet.
  const url = parseJsonOr(Published, text, null)?.url;
  if (url === undefined) return null;
  const healthy = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) }).then(
    (response) => response.ok,
    () => false,
  );
  return healthy ? url : null;
}

export interface RunClaudeOptions {
  args: string[];
  config: Config;
  /** The folder claude runs in: the project whose personas count. The process's when absent. */
  cwd?: string;
  env: Record<string, string | undefined>;
  /** This daemon's command line, which `claude` runs as the channel's MCP server. */
  self: string[];
  log: Pick<Logger, "error">;
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
    const message = (error as Error).message;
    // Not found: say which ids do exist, so the person can correct the word.
    const known = message.startsWith("not_found")
      ? await personaIds(opts.config, opts.cwd ?? process.cwd()).catch(() => [])
      : [];
    const hint = known.length > 0 ? ` (personas that exist: ${known.join(", ")})` : "";
    opts.log.error(`flightdeckd: persona ${personaId}: ${message}${hint}`);
    return "failed";
  }
}

/** What is said when the channel config cannot be written: the session opens with neither flag. */
const CHANNEL_NOTICE =
  "flightdeckd: could not write the channel config; opening claude without the channel (the app will not be able to send messages)";

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
    added.push(
      ...(await systemPromptArgs(opts, args, persona, `${launchId}.md`, write)),
      ...(await agentArgs(opts, { claude, args, print, launchId }, write)),
    );
    return await launchClaude(
      buildClaudeLaunch({
        claude,
        args: [...added, ...args],
        mcpConfigPath: channel,
      }),
      {
        ...env,
        // Print mode is not a session of a terminal: no exporter.
        ...wrapperTelemetryEnv(env, print ? null : await telemetryTarget(opts.config)),
        FLIGHTDECK_LAUNCH_ID: launchId,
        // The badge only (never the body): the SessionStart hook forwards it to the central.
        ...personaBadge(persona),
      },
    );
  } finally {
    // `claude --bg` returns at once and the session goes on: its channel config and persona
    // files are still read, so they stay (a few small files per background session).
    if (!background) await removeLaunch(files, made.folder);
  }
}

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

/** The ids of the personas this host and the project offer. */
async function personaIds(config: Config, cwd: string): Promise<string[]> {
  const daemon = await DaemonClient.connect(daemonUrl(config), config.token, "flightdeckd-claude");
  try {
    const { personas } = await daemon.call("personas.list", { projectPath: cwd });
    return personas.map((persona) => persona.id);
  } finally {
    daemon.close();
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
