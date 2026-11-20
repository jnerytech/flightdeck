/**
 * Issue #3539: `flightdeckd watch get|trace|describe|by-url|settings`, the read side of a card's PR
 * watch from a terminal. Each verb asks the daemon for something it already keeps and changes nothing:
 * `describe` makes the PR description from the card's sessions and opens nothing, `by-url` looks a link
 * up and fetches nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  byUrlLines,
  describeParts,
  settingsJson,
  settingsLines,
  traceLines,
  watchJson,
  watchLines,
} from "./domain/watch-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface WatchCliArgs {
  action: "get" | "trace" | "describe" | "by-url" | "settings";
  /** A card id, a PR link or a project (its name or its id), by the action. */
  target: string;
  json?: boolean;
}

export function runWatchCli(
  args: WatchCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-watch",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      if (args.action === "get") {
        const info = await daemon.call("watch.get", { cardId: args.target });
        return args.json ? json(watchJson(info)) : said(...watchLines(info));
      }
      if (args.action === "trace") {
        const trace = await daemon.call("watch.trace", { cardId: args.target });
        return args.json ? json(trace) : said(...traceLines(trace));
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
        return args.json ? json(found) : said(...byUrlLines(found));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      const settings = await daemon.call("watch.settings", { projectId: chosen.id });
      return args.json
        ? json(settingsJson(settings))
        : said(...settingsLines(chosen.name, settings));
    },
  });
}
