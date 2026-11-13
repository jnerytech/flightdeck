import { parseArgs } from "./args.ts";
import { type CliDeps, COMMANDS } from "./commands.ts";
import { reportFailure } from "./exit.ts";

/**
 * Runs the command `argv` names, if it is one that is not the daemon, and says whether it did
 * (#1692). The process entry calls this before it imports `main.ts`, so a short command such as
 * `statusline` never loads the daemon. A failure is reported and exits, and still counts as handled.
 */
export async function runCommandCli(argv: readonly string[], deps: CliDeps): Promise<boolean> {
  try {
    const args = parseArgs(argv);
    const run = COMMANDS[args.command];
    if (!run) return false;
    const code = await run(args, deps);
    if (code !== null) deps.exit(code);
    return true;
  } catch (error) {
    reportFailure(error, deps);
    return true;
  }
}
