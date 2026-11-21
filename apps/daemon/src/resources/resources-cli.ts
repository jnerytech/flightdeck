/**
 * Issue #3699: `flightdeckd resources`, what the host's work costs it (memory, disk, each session and
 * terminal, the orphans), from a shell. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  endedLine,
  guardLine,
  resourcesJson,
  resourcesLines,
  UNSURE_GUARD,
  UNSURE_ORPHAN,
} from "./domain/resources-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ResourcesCliArgs {
  json?: boolean;
  /** A verb that changes the host (#3699); none reads the snapshot. */
  action?: "pause-at" | "end-orphan";
  /** `pause-at <share|off>`: null is off. */
  pauseAt?: number | null;
  /** `end-orphan <pid> <start-ticks>`: the pair the read printed. */
  pid?: number;
  startTicks?: number;
}

export async function runResourcesCli(
  args: ResourcesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-resources",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action ? { unsure: args.action === "pause-at" ? UNSURE_GUARD : UNSURE_ORPHAN } : {}),
    perform: async (daemon, note) => {
      if (args.action === "pause-at") {
        note.wrote = true;
        const state = await daemon.call("resources.setPauseAt", { pauseAt: args.pauseAt ?? null });
        return shown(args.json, state, () => [guardLine(state.pauseAt)]);
      }
      if (args.action === "end-orphan") {
        note.wrote = true;
        const pid = args.pid ?? 0;
        const result = await daemon.call("resources.endOrphan", {
          pid,
          startTicks: args.startTicks ?? 0,
        });
        return shown(args.json, result, () => [endedLine(pid)]);
      }
      const snapshot = await daemon.call("resources.get", {});
      return shown(args.json, resourcesJson(snapshot), () => resourcesLines(snapshot));
    },
  });
}
