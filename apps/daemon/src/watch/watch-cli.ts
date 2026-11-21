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
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
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
      if (args.action === "follow")
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
      if (args.action === "set" || args.action === "extend" || args.action === "resolve-held") {
        note.wrote = true;
        const info =
          args.action === "set"
            ? await daemon.call("watch.set", { cardId: args.target, enabled: args.enabled })
            : args.action === "extend"
              ? await daemon.call("watch.extend", { cardId: args.target, rounds: args.rounds })
              : await daemon.call("watch.resolveHeld", {
                  cardId: args.target,
                  roundId: args.round,
                  action: args.resolution,
                });
        if (args.json) return json(watchJson(info));
        return said(
          ...(args.action === "resolve-held" ? [resolvedLine(args.resolution, args.round)] : []),
          ...watchLines(info),
        );
      }
      if (args.action === "get") {
        const info = await daemon.call("watch.get", { cardId: args.target });
        return args.json ? json(watchJson(info)) : said(...watchLines(info));
      }
      if (args.action === "trace") {
        const trace = await daemon.call("watch.trace", { cardId: args.target });
        return args.json ? json(traceJson(trace)) : said(...traceLines(trace));
      }
      if (args.action === "describe") {
        const result = await daemon.call("watch.describe", { cardId: args.target });
        if (args.json) return json(result);
        const { lines, notice } = describeParts(result);
        const printed = said(...lines);
        return notice === null ? printed : { ...printed, err: [notice] };
      }
      if (args.action === "by-url") {
        const found = await daemon.call("watch.byUrl", { url: args.target });
        return args.json ? json(byUrlJson(found)) : said(...byUrlLines(found));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      const patch = args.action === "settings" ? args.patch : undefined;
      note.wrote = patch !== undefined;
      const settings = await daemon.call("watch.settings", {
        projectId: chosen.id,
        ...(patch ? { patch } : {}),
      });
      return args.json
        ? json(settingsJson(settings))
        : said(...settingsLines(chosen.name, settings));
    },
  });
}
