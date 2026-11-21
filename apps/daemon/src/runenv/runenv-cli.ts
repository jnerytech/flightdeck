/**
 * Issue #3621: `flightdeckd runenv`, a card's run environment from a terminal. `config` and `get` ask the
 * daemon for something it already keeps and change nothing; `watch` writes the run state of each card as
 * the daemon pushes it, until Ctrl-C. `trust` lets a project's run.yaml run, `start` runs its commands and
 * `stop` ends them; a daemon that does not answer one leaves its result unknown. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
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

/** What a write that got no answer may have done, and where to look: the project's file for `trust`, the card's run for the rest. */
const unsure = (action: RunenvCliArgs["action"]) =>
  `; the change may or may not have been made: check with \`runenv ${action === "trust" ? "config" : "get"}\` before trying again`;

/** A project (its name or its id) or a card id, by the action; `trust` also takes the hash of the file the person reviewed. */
export type RunenvCliArgs =
  | { action: "config" | "get" | "start" | "stop"; target: string; json?: boolean }
  | { action: "trust"; target: string; hash: string; json?: boolean }
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
    unsure: unsure(args.action),
    perform: async (daemon, note, flow) => {
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
      if (args.action === "get" || args.action === "start" || args.action === "stop") {
        note.wrote = args.action !== "get";
        const state = await daemon.call(`runenv.${args.action}`, { cardId: args.target });
        return shown(args.json, stateJson(state), () => stateLines(state));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      note.wrote = args.action === "trust";
      const info =
        args.action === "trust"
          ? await daemon.call("runenv.trust", { projectId: chosen.id, hash: args.hash })
          : await daemon.call("runenv.config", { projectId: chosen.id });
      return shown(args.json, configJson(info), () => configLines(chosen.name, info));
    },
  });
}
