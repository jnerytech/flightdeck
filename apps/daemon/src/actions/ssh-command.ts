/**
 * Phase 17: what an `ssh:` action sends to the remote host. ssh joins the words of the remote
 * command and hands them to the login shell, so each argument is quoted to arrive as itself; the
 * environment goes over stdin, never on a command line, where it would show in the process list.
 */

import { FlightdeckError } from "../errors.ts";

/** Reads `NAME=value` lines up to the first empty one, exports each, then runs the arguments. */
const PRELUDE = 'while IFS= read -r l && [ -n "$l" ]; do export "$l"; done; exec "$@"';
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One argument of the remote command, single-quoted for a POSIX shell. */
export function quoteArg(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

/** The remote command: a fixed prelude exports the stdin's `NAME=value` lines, then runs argv. */
export function remoteCommand(argv: string[]): string {
  return ["sh", "-c", PRELUDE, "flightdeck-action", ...argv].map(quoteArg).join(" ");
}

/** The stdin of an `ssh:` action: one `NAME=value` line per variable, then an empty line. */
export function envInput(env: Record<string, string>): string {
  const lines = Object.entries(env).map(([name, value]) => {
    if (!NAME.test(name)) {
      throw new FlightdeckError(
        "bad_request",
        `invalid variable name for ssh: ${name}`,
        "action_ssh_env_name",
        { name },
      );
    }
    if (/[\n\r\0]/.test(value)) {
      throw new FlightdeckError(
        "bad_request",
        `variable ${name} has a line break or NUL, which an ssh action does not send`,
        "action_ssh_env_value",
        { name },
      );
    }
    return `${name}=${value}\n`;
  });
  return `${lines.join("")}\n`;
}
