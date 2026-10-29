import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { ulid } from "../ulid.ts";
import { whichOnPath } from "../which.ts";

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

export interface RunClaudeOptions {
  args: string[];
  config: Config;
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
  const launchId = ulid();
  // Print mode ignores development channels: plain claude, no channel, no warning.
  const print = opts.args.includes("-p") || opts.args.includes("--print");
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
  const proc = Bun.spawn(buildClaudeLaunch({ claude, args: opts.args, mcpConfigPath }), {
    env: { ...opts.env, FLIGHTDECK_LAUNCH_ID: launchId },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (mcpConfigPath) rmSync(mcpConfigPath, { force: true });
  return code;
}
