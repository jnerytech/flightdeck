/**
 * Issue #3540: `flightdeckd boardsync boards|status|log`, the read side of a project's GitHub Projects
 * board sync from a terminal. Each verb asks the daemon for something it already keeps and changes
 * nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
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
  boardLines,
  logJson,
  logLines,
  statusJson,
  statusLines,
} from "./domain/boardsync-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export type BoardsyncCliArgs =
  | { action: "boards"; json?: boolean }
  | {
      action:
        | "status"
        | "log"
        | "unlink"
        | "sync-now" /** A project (its name or its id) or a card id, by the action. */;
      target: string;
      json?: boolean;
    }
  | {
      action: "link";
      target: string;
      boardId: string;
      columnMap?: Record<string, string>;
      json?: boolean;
    }
  | { action: "set-map"; target: string; columnMap: Record<string, string>; json?: boolean }
  | { action: "set-push"; target: string; push: boolean; confirm?: boolean; json?: boolean };

export function runBoardsyncCli(
  args: BoardsyncCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-boardsync",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      if (args.action === "boards") {
        const { boards } = await daemon.call("boardsync.boards", {});
        return args.json ? json({ boards }) : said(...boardLines(boards));
      }
      if (args.action === "log") {
        const { entries } = await daemon.call("boardsync.log", { cardId: args.target });
        return args.json
          ? json({ entries: logJson(entries) })
          : said(...logLines(args.target, entries));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      const status = await daemon.call("boardsync.status", { projectId: chosen.id });
      return args.json ? json(statusJson(status)) : said(...statusLines(chosen.name, status));
    },
  });
}
