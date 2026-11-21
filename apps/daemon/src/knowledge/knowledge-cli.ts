/**
 * Issue #3623: `flightdeckd knowledge`, a project's document library from a shell (the app's Agent setup
 * screen). `list` reads the documents with their status and the hash a status change needs, `index` prints
 * the text a session is given of them and `feed` says whether the project gets it. The project is a name or
 * an id the host knows, or an absolute folder the daemon then checks against its allowed roots. Exit codes:
 * 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  feedJson,
  feedLines,
  indexJson,
  indexLines,
  listJson,
  listLines,
} from "./domain/knowledge-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project's name or id, or the folder of one (a path starts with `/`, `\`, or a drive letter). */
export interface KnowledgeCliArgs {
  action: "list" | "index" | "feed";
  project: string;
  json?: boolean;
}

const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/u;

export function runKnowledgeCli(
  args: KnowledgeCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-knowledge",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.project);
      let path: string;
      if (!("refusal" in chosen)) {
        const found = projects.find((p) => p.id === chosen.id);
        if (!found) return failure(1, `no project named "${args.project}"`);
        path = found.path;
      } else if (ABSOLUTE.test(args.project)) path = args.project;
      else return chosen.refusal;
      if (args.action === "list") {
        const list = await daemon.call("knowledge.list", { path });
        return shown(args.json, listJson(list), () => listLines(list));
      }
      if (args.action === "index") {
        const index = await daemon.call("knowledge.index", { path });
        return shown(args.json, indexJson(index), () => indexLines(index));
      }
      const feed = await daemon.call("knowledge.feed", { path });
      return shown(args.json, feedJson(feed), () => feedLines(feed));
    },
  });
}
