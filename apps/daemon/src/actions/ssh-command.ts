/**
 * Phase 17: what an `ssh:` action sends to the remote host. ssh joins the words of the remote
 * command and hands them to the login shell, so each argument is quoted to arrive as itself; the
 * environment goes over stdin, never on a command line, where it would show in the process list.
 */

/** One argument of the remote command, single-quoted for a POSIX shell. */
export function quoteArg(_arg: string): string {
  return "";
}

/** The remote command: a fixed prelude exports the stdin's `NAME=value` lines, then runs argv. */
export function remoteCommand(_argv: string[]): string {
  return "";
}

/** The stdin of an `ssh:` action: one `NAME=value` line per variable, then an empty line. */
export function envInput(_env: Record<string, string>): string {
  return "";
}
