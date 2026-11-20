/**
 * Issue #3424: `flightdeckd sessions [--json]`, the sessions of the local daemon from a terminal or a
 * script. It asks `session.list` like the app does, with the token of the config. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";

export interface SessionsCliArgs {
  /** `--json`: one array of small objects, for a script. */
  json?: boolean;
}

export interface SessionsCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export function runSessionsCli(
  args: SessionsCliArgs,
  config: { bind: string; port: number; token: string },
  options: SessionsCliOptions = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-sessions",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { sessions } = await daemon.call("session.list", {});
      // A small, stable shape on purpose: the rest of a summary changes with the app, and a path or a
      // transcript id in a script's output is not what this command is for.
      const rows = sessions.map((s) => ({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        status: s.status,
        permissionMode: s.permissionMode,
        updatedAt: s.updatedAt,
      }));
      return args.json ? json(rows) : said(...rows.map((r) => `${r.name}  ${r.status}  ${r.cwd}`));
    },
  });
}
