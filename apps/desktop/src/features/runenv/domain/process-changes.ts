import type { RunProcessState } from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";

/** How a process is doing, in words: a process that ended with no exit code (a signal) says so. */
export function processState(process: RunProcessState, t: T): string {
  if (process.status === "running") return t("runEnv.procRunning");
  if (process.exitCode === null) return t("runEnv.procEndedNoCode");
  return t("runEnv.procExited", { code: String(process.exitCode) });
}

/**
 * What changed between two reports of a run's processes, as one line a screen reader can say:
 * "api is ready. web ended (code 2)". Only a process turning ready, timing out or ending counts;
 * an empty line means nothing to say. A process is matched by its terminal.
 */
export function processChanges(
  before: readonly RunProcessState[],
  after: readonly RunProcessState[],
  t: T,
): string {
  const known = new Map(before.map((process) => [process.terminalId, process]));
  const lines: string[] = [];
  for (const process of after) {
    const old = known.get(process.terminalId);
    const { name } = process;
    if (process.status === "exited" && old?.status !== "exited") {
      lines.push(`${name} ${processState(process, t)}`);
    } else if (process.ready === "ready" && old?.ready !== "ready") {
      lines.push(t("runEnv.procReady", { name }));
    } else if (process.ready === "timeout" && old?.ready !== "timeout") {
      lines.push(t("runEnv.previewTimeout", { name }));
    }
  }
  return lines.join(". ");
}
