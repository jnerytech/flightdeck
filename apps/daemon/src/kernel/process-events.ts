/** The process events the daemon's end is traced from. */
export type ProcessEventName = "uncaughtException" | "unhandledRejection" | "exit";

/**
 * `process.on` as `bin.ts` hands it over: injected, so a test fires the events itself and the
 * runner's own process never gets a handler. The argument is the error, or the code for `exit`.
 */
export type OnProcessEvent = (event: ProcessEventName, handler: (arg: unknown) => void) => void;
