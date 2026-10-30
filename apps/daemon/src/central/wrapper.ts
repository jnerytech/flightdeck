import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedPersonaResult } from "@flightdeck/protocol";
import type { Config } from "../config.ts";
import { DaemonClient, daemonUrl } from "../mcp.ts";
import { ulid } from "../ulid.ts";
import { whichOnPath } from "../which.ts";

/** The launch id an app terminal asks `flightdeckd claude` to use. */
export const TERMINAL_LAUNCH_VAR = "FLIGHTDECK_TERMINAL_LAUNCH_ID";

/** Where the daemon publishes its receptor's URL, inside `dataDir`. */
export const RECEPTOR_FILE = "receptor.json";

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

/** The local daemon's receptor URL, if it answers within `timeoutMs`. */
async function liveReceptor(dataDir: string, timeoutMs: number): Promise<string | null> {
  const file = join(dataDir, RECEPTOR_FILE);
  if (!existsSync(file)) return null;
  const { url } = JSON.parse(readFileSync(file, "utf8")) as { url: string };
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
  const { [TERMINAL_LAUNCH_VAR]: requested, ...env } = opts.env;
  const launchId = requested && /^[0-9A-Z]{26}$/.test(requested) ? requested : ulid();
  // Print mode ignores development channels: plain claude, no channel, no warning.
  const { id: personaId, rest: args, broken } = takePersonaFlag(opts.args);
  if (broken) {
    opts.log.error("flightdeckd: --persona pede o id da persona");
    return 1;
  }
  // Asked for on purpose, so a persona that cannot be had stops here: no claude without the role.
  let persona: ResolvedPersonaResult | null = null;
  if (personaId) {
    try {
      persona = await fetchPersona(opts.config, personaId, opts.cwd ?? process.cwd());
    } catch (error) {
      opts.log.error(`flightdeckd: persona ${personaId}: ${(error as Error).message}`);
      return 1;
    }
  }
  const print = args.includes("-p") || args.includes("--print");
  const url = print ? null : await liveReceptor(opts.config.dataDir, opts.timeoutMs);
  const token = opts.config.hooks.token;
  let mcpConfigPath: string | null = null;
  if (url && token) {
    const dir = join(opts.config.dataDir, "channels");
    mkdirSync(dir, { recursive: true });
    mcpConfigPath = join(dir, `${launchId}.json`);
    const [command, ...rest] = opts.self;
    const args = [...rest, "channel", "--launch", launchId, "--url", url, "--token", token];
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { flightdeck: { command, args } } }));
  } else if (!print) {
    opts.log.error(
      "flightdeckd: daemon do Flightdeck fora do ar; abrindo o claude sem o canal (o app não poderá mandar mensagens)",
    );
  }
  // The body travels in a file that only lives while claude runs.
  let personaFile: string | null = null;
  if (persona) {
    const dir = join(opts.config.dataDir, "personas");
    mkdirSync(dir, { recursive: true });
    personaFile = join(dir, `${launchId}.md`);
    writeFileSync(personaFile, persona.persona.body);
  }
  try {
    const proc = Bun.spawn(
      buildClaudeLaunch({
        claude,
        args:
          persona && personaFile
            ? [...personaArgs(persona.persona, personaFile, args), ...args]
            : args,
        mcpConfigPath,
      }),
      {
        env: { ...env, FLIGHTDECK_LAUNCH_ID: launchId },
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    return await proc.exited;
  } finally {
    if (mcpConfigPath) rmSync(mcpConfigPath, { force: true });
    if (personaFile) rmSync(personaFile, { force: true });
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
