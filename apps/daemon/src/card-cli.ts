/**
 * Issue #1507: `flightdeckd card list|show|new|start`, the board from a terminal, a git alias, a cron
 * job or a CI step. It speaks to the local daemon like the MCP server does (the same `DaemonClient`,
 * the token of the config), and the daemon applies the same rules as for the app: the queue, the
 * holds and the limits. Exit codes: 0 done (a start that must wait says why), 1 refused, 2 no daemon.
 */

export interface CardCliArgs {
  action: "list" | "show" | "new" | "start";
  /** `--project`: an id or a name; without it, the only project of the host. */
  project?: string | undefined;
  /** `show` and `start`: the card. */
  id?: string | undefined;
  /** `new`: the title. */
  title?: string | undefined;
  description?: string | undefined;
  /** `start --workflow`. */
  workflow?: string | undefined;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean | undefined;
}

export interface CardCliResult {
  code: 0 | 1 | 2;
  out: string[];
  err: string[];
}

export function isLoopbackHost(_host: string): boolean {
  return false;
}

export interface CardCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export async function runCardCli(
  _args: CardCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: CardCliOptions = {},
): Promise<CardCliResult> {
  return { code: 1, out: [], err: [] };
}
