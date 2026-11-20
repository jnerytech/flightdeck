import type { OnProcessEvent } from "../kernel/index.ts";
import type { FileLog } from "./file-log.ts";

/** What the trace tells the daemon: its own clean stop, after which the process ending says nothing. */
export interface ProcessTrace {
  stopped(): void;
}

export function traceProcessEnd(
  _on: OnProcessEvent,
  _exit: (code: number) => void,
  _fileLog: Pick<FileLog, "writeAtExit">,
): ProcessTrace {
  return { stopped: () => {} };
}
