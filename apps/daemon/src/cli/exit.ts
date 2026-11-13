import { AlreadyRunningError, EXIT_ALREADY_RUNNING, type Logger } from "../kernel/index.ts";

/** What the failure paths need of the command line deps. */
interface FailureDeps {
  log: Logger;
  exit(code: number): void;
}

/** Prints what stopped a command or the daemon's start, and exits: 3 when another daemon holds the lock, else 1. */
export function reportFailure(error: unknown, deps: FailureDeps): void {
  deps.log.error(`flightdeckd: ${error instanceof Error ? error.message : String(error)}`);
  deps.exit(error instanceof AlreadyRunningError ? EXIT_ALREADY_RUNNING : 1);
}

/**
 * Exits 0 once `closed` settles (claude closed the transport). A `closed` that rejects, or an exit
 * that throws, is reported and exits 1 instead of leaving an unhandled rejection with the process open.
 */
export function exitWhenClosed(closed: Promise<void>, deps: FailureDeps): Promise<void> {
  return closed.then(() => deps.exit(0)).catch((error) => reportFailure(error, deps));
}
