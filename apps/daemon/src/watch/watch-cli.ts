/**
 * Issue #3539: `flightdeckd watch`, a card's PR watch from a terminal. `get`, `trace`, `describe`, `by-url`
 * and `settings` without a patch ask the daemon for something it already keeps and change nothing:
 * `follow` writes the watch of each card as the daemon pushes it, until Ctrl-C; `describe` makes the PR description from the card's sessions and opens nothing, `by-url` looks a link
 * up and fetches nothing. `set`, `extend`, `resolve-held` and `settings` with a patch change what the
 * watch does unattended; a daemon that does not answer one leaves its result unknown. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import type { WatchSettings } from "@flightdeck/protocol";
import {
  type CliResult,
  type DaemonClient,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
  shown,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  byUrlJson,
  byUrlLines,
  describeParts,
  resolvedLine,
  settingsJson,
  settingsLines,
  traceJson,
  traceLines,
  UNSURE,
  watchJson,
  watchLines,
} from "./domain/watch-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A card id, a PR link or a project (its name or its id), by the action. */
export type WatchCliArgs = { target: string; json?: boolean } & (
  | { action: "get" | "trace" | "describe" | "by-url" | "follow" }
  | { action: "settings"; patch?: Partial<WatchSettings> }
  | { action: "set"; enabled: boolean | null }
  | { action: "extend"; rounds: number }
  | { action: "resolve-held"; round: string; resolution: "push" | "drop" }
);

export function runWatchCli(
  args: WatchCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    /** `follow` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `follow` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-watch",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note, flow) => {
      switch (args.action) {
        case "follow":
          return streamFrames({
            daemon,
            flow,
            signal: options.signal ?? new AbortController().signal,
            write: options.write ?? (() => undefined),
            open: () => daemon.call("watch.watch", {}),
            type: "watch.updated",
            line: ({ watch }) =>
              args.json ? JSON.stringify(watchJson(watch)) : watchLines(watch).join("\n"),
          });
        case "set":
        case "extend":
        case "resolve-held":
          return changeWatch(args, daemon, note);
        case "get": {
          const info = await daemon.call("watch.get", { cardId: args.target });
          return shown(args.json, watchJson(info), () => watchLines(info));
        }
        case "trace": {
          const trace = await daemon.call("watch.trace", { cardId: args.target });
          return shown(args.json, traceJson(trace), () => traceLines(trace));
        }
        case "describe":
          return describeOut(args, daemon);
        case "by-url": {
          const found = await daemon.call("watch.byUrl", { url: args.target });
          return shown(args.json, byUrlJson(found), () => byUrlLines(found));
        }
        default:
          return settingsOf(args, daemon, note);
      }
    },
  });
}

type WatchChange = Extract<WatchCliArgs, { action: "set" | "extend" | "resolve-held" }>;

function applyChange(daemon: DaemonClient, args: WatchChange) {
  if (args.action === "set")
    return daemon.call("watch.set", { cardId: args.target, enabled: args.enabled });
  if (args.action === "extend")
    return daemon.call("watch.extend", { cardId: args.target, rounds: args.rounds });
  return daemon.call("watch.resolveHeld", {
    cardId: args.target,
    roundId: args.round,
    action: args.resolution,
  });
}

/** `set`, `extend` and `resolve-held` change what the watch does unattended, so the result is unknown when the daemon does not answer. */
async function changeWatch(
  args: WatchChange,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  note.wrote = true;
  const info = await applyChange(daemon, args);
  if (args.json) return json(watchJson(info));
  return said(
    ...(args.action === "resolve-held" ? [resolvedLine(args.resolution, args.round)] : []),
    ...watchLines(info),
  );
}

/** The PR description is made from the card's sessions; a notice goes to stderr, apart from the text. */
async function describeOut(args: WatchCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const result = await daemon.call("watch.describe", { cardId: args.target });
  if (args.json) return json(result);
  const { lines, notice } = describeParts(result);
  const printed = said(...lines);
  return notice === null ? printed : { ...printed, err: [notice] };
}

/** A project's watch settings (a name or an id, looked up first), read or changed by a patch. */
async function settingsOf(
  args: WatchCliArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const chosen = resolveProject(projects, args.target);
  if ("refusal" in chosen) return chosen.refusal;
  const patch = args.action === "settings" ? args.patch : undefined;
  note.wrote = patch !== undefined;
  const settings = await daemon.call("watch.settings", {
    projectId: chosen.id,
    ...(patch ? { patch } : {}),
  });
  return shown(args.json, settingsJson(settings), () => settingsLines(chosen.name, settings));
}
