/**
 * Issue #3515: `flightdeckd project trust-state|stack|trust-inspect|harness-preview`, what a host knows of a
 * project's folder from a terminal or a script. It speaks to the daemon like `flightdeckd plugins` does (the
 * same `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb here
 * reads: nothing is trusted, written or run.
 */
import { resolve } from "node:path";
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  inspectLines,
  type ProjectCliArgs,
  previewLines,
  stackLines,
  trustLines,
} from "./domain/project-cli-view.ts";

/** A preview reads the folder's files and a template's, which takes longer than a lookup. */
const DEFAULT_TIMEOUT_MS = 30_000;

export function runProjectCli(
  args: ProjectCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  // A relative folder means the shell's, so it is made absolute here; another host's folders are given absolute.
  const folder = (path: string) => (options.remote ? path : resolve(path));
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-project",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      if (args.action === "trust-state") {
        const answer = await daemon.call("project.trust.state", { paths: args.paths.map(folder) });
        return args.json ? json(answer) : said(...trustLines(answer));
      }
      if (args.action === "stack") {
        const answer = await daemon.call("project.harness.stack", { path: folder(args.path) });
        return args.json ? json(answer) : said(...stackLines(answer));
      }
      if (args.action === "trust-inspect") {
        const answer = await daemon.call("project.trust.inspect", { path: folder(args.path) });
        return args.json ? json(answer) : said(...inspectLines(answer));
      }
      const { parts, template } = args;
      const answer = await daemon.call("project.harness.preview", {
        path: folder(args.path),
        parts,
        ...(template === undefined ? {} : { template }),
      });
      return args.json ? json(answer) : said(...previewLines(answer));
    },
  });
}
