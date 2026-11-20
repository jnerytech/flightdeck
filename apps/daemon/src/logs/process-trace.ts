import type { OnProcessEvent } from "../kernel/index.ts";
import type { FileLog } from "./file-log.ts";

/** What the trace tells the daemon: its own clean stop, after which the process ending says nothing. */
export interface ProcessTrace {
  stopped(): void;
}

/** An error nobody caught, as one line's text: the stack when there is one, else what was thrown. */
function describe(thrown: unknown): string {
  try {
    return thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown);
  } catch {
    return "a value that cannot be shown";
  }
}

/**
 * Leaves a line in the daemon's log when the process ends in a way nobody logged (#3403): an error
 * nobody caught (the line has its stack, and the process ends with 1, as it did before the handler)
 * or an exit that is not the daemon's own clean stop. A crash is one line, not two, and a clean stop
 * (`stopped()`) adds none. The line goes in at once: a process that is ending runs no more async work.
 */
export function traceProcessEnd(
  on: OnProcessEvent,
  exit: (code: number) => void,
  fileLog: Pick<FileLog, "writeAtExit">,
): ProcessTrace {
  let traced = false;
  const crash = (event: "uncaughtException" | "unhandledRejection") => (thrown: unknown) => {
    if (!traced) fileLog.writeAtExit("error", `${event}: ${describe(thrown)}`);
    traced = true;
    // A registered handler removes the default exit: the process must end by itself.
    exit(1);
  };
  on("uncaughtException", crash("uncaughtException"));
  on("unhandledRejection", crash("unhandledRejection"));
  on("exit", (code) => {
    if (traced) return;
    traced = true;
    fileLog.writeAtExit(
      code === 0 ? "info" : "error",
      `the daemon's process ended: exit code ${String(code)}`,
    );
  });
  return {
    stopped: () => {
      traced = true;
    },
  };
}
