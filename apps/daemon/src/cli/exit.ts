import { AlreadyRunningError, EXIT_ALREADY_RUNNING } from "../kernel/index.ts";
import type { CliDeps } from "./commands.ts";

/** Prints what stopped a command or the daemon's start, and exits: 3 when another daemon holds the lock, else 1. */
export function reportFailure(error: unknown, deps: Pick<CliDeps, "log" | "exit">): void {
  deps.log.error(`flightdeckd: ${error instanceof Error ? error.message : String(error)}`);
  deps.exit(error instanceof AlreadyRunningError ? EXIT_ALREADY_RUNNING : 1);
}

/**
 * Exits 0 once `closed` settles (claude closed the transport). A `closed` that rejects, or an exit
 * that throws, is reported and exits 1 instead of leaving an unhandled rejection with the process open.
 */
export function exitWhenClosed(
  closed: Promise<void>,
  deps: Pick<CliDeps, "log" | "exit">,
): Promise<void> {
  return closed.then(() => deps.exit(0));
}
