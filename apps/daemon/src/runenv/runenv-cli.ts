/**
 * Issue #3621: `flightdeckd runenv config|get|watch`, the read side of a card's run environment from a
 * terminal. `config` and `get` ask the daemon for something it already keeps and change nothing; `watch`
 * writes the run state of each card as the daemon pushes it, until Ctrl-C. Exit codes: 0 done, 1 refused,
 * 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  configJson,
  configLines,
  stateJson,
  stateLines,
  streamLine,
} from "./domain/runenv-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project (its name or its id) or a card id, by the action. */
export type RunenvCliArgs =
  | { action: "config" | "get"; target: string; json?: boolean }
  | { action: "watch"; json?: boolean };

export function runRunenvCli(
  args: RunenvCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-runenv",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon, _note, flow) => {
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          signal: options.signal ?? new AbortController().signal,
          write: options.write ?? (() => undefined),
          open: () => daemon.call("runenv.watch", {}),
          type: "runenv.updated",
          line: ({ state }) => (args.json ? JSON.stringify(stateJson(state)) : streamLine(state)),
        });
      if (args.action === "get") {
        const state = await daemon.call("runenv.get", { cardId: args.target });
        return shown(args.json, stateJson(state), () => stateLines(state));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      const info = await daemon.call("runenv.config", { projectId: chosen.id });
      return shown(args.json, configJson(info), () => configLines(chosen.name, info));
    },
  });
}
