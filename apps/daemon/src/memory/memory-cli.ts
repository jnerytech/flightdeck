/**
 * Issue #3618: `flightdeckd memory list|read|budget|suggest`, a project's Claude Code auto memory (the
 * app's Memory screen) from a terminal. They ask the daemon for what it already keeps and change nothing.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  DaemonRefusal,
  failure,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  budgetLines,
  deletedLine,
  fileJson,
  listingJson,
  listLines,
  readLines,
  suggestionJson,
  suggestLines,
  wroteLine,
} from "./domain/memory-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE =
  "; the memory file may or may not have changed: read it again before you write again";

export type MemoryCliArgs = { project: string; json?: boolean } & (
  | { action: "list" | "budget" | "suggest" }
  | { action: "read"; name: string }
  | {
      action: "write";
      name: string;
      /** The file with the new content, or `-` for standard input. */
      file: string;
      /** The hash `read` printed; `null` for a file that must not exist yet. */
      expectedHash: string | null;
      confirm: true;
    }
  | { action: "delete"; name: string; expectedHash: string; confirm: true }
);

export function runMemoryCli(
  args: MemoryCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    remote?: RemoteTarget | undefined;
    stdin?: ReadableStream<Uint8Array> | undefined;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-memory",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon) => {
      const { projects } = await daemon.call("project.list", {});
      const found = resolveProject(projects, args.project);
      if ("refusal" in found) return found.refusal;
      const projectId = found.id;
      try {
        switch (args.action) {
          case "list": {
            const listing = await daemon.call("memory.list", { projectId });
            return args.json ? json(listingJson(listing)) : said(...listLines(listing));
          }
          case "read": {
            const file = await daemon.call("memory.read", { projectId, name: args.name });
            return args.json
              ? json({ ...fileJson(file), content: file.content })
              : said(...readLines(file, file.content));
          }
          case "budget": {
            const budget = await daemon.call("memory.budget", { projectId });
            return args.json ? json(budget) : said(...budgetLines(budget));
          }
          case "write":
            return said("");
          case "delete":
            return said("");
          case "suggest": {
            const { suggestions } = await daemon.call("memory.suggest", { projectId });
            return args.json
              ? json({ suggestions: suggestions.map(suggestionJson) })
              : said(...suggestLines(suggestions));
          }
        }
      } catch (error) {
        if (error instanceof DaemonRefusal) return failure(1, error.message, error.reason);
        throw error;
      }
    },
  });
}
