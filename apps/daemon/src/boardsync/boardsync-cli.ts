/**
 * Issue #3540: `flightdeckd boardsync boards|status|log`, the read side of a project's GitHub Projects
 * board sync from a terminal. Each verb asks the daemon for something it already keeps and changes
 * nothing. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import type { BoardColumn } from "@flightdeck/protocol";
import {
  type CliResult,
  type DaemonClient,
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
  reportLines,
  statusJson,
  statusLines,
} from "./domain/boardsync-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
/** A link and a sync read the whole board, a page at a time. */
const SYNC_TIMEOUT_MS = 60_000;

/** What a write that got no answer may have done: the person looks at the status before repeating it. */
const UNSURE =
  "; the change may or may not have happened: run boardsync status before repeating it";

export type BoardsyncCliArgs =
  | { action: "boards"; json?: boolean }
  /** The target is a project (its name or its id), or a card id for `log`. */
  | { action: "status"; target: string; json?: boolean }
  | { action: "log"; target: string; json?: boolean }
  | { action: "unlink" | "sync-now"; target: string; json?: boolean }
  | {
      action: "link";
      target: string;
      boardId: string;
      columnMap?: Record<string, BoardColumn>;
      json?: boolean;
    }
  | { action: "set-map"; target: string; columnMap: Record<string, BoardColumn>; json?: boolean }
  | { action: "set-push"; target: string; push: boolean; confirm?: boolean; json?: boolean };

type Write = Exclude<BoardsyncCliArgs, { action: "boards" | "status" | "log" }>;

/** A project's write: the project is found by name or id, then the one request is sent. `note.wrote` is set just before it. */
async function writeToProject(
  args: Write,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const chosen = resolveProject(projects, args.target);
  if ("refusal" in chosen) return chosen.refusal;
  const projectId = chosen.id;
  note.wrote = true;
  switch (args.action) {
    case "link": {
      const status = await daemon.call("boardsync.link", {
        projectId,
        boardId: args.boardId,
        ...(args.columnMap ? { columnMap: args.columnMap } : {}),
      });
      return args.json ? json(statusJson(status)) : said(...statusLines(chosen.name, status));
    }
    case "unlink":
      await daemon.call("boardsync.unlink", { projectId });
      return args.json
        ? json({ unlinked: true, projectId })
        : said(`${chosen.name}: unlinked from its board`);
    case "set-map": {
      const status = await daemon.call("boardsync.setMap", {
        projectId,
        columnMap: args.columnMap,
      });
      return args.json ? json(statusJson(status)) : said(...statusLines(chosen.name, status));
    }
    case "set-push": {
      const status = await daemon.call("boardsync.setPush", {
        projectId,
        push: args.push,
        confirm: args.confirm === true,
      });
      return args.json ? json(statusJson(status)) : said(...statusLines(chosen.name, status));
    }
    case "sync-now": {
      const { status, report } = await daemon.call("boardsync.syncNow", { projectId });
      return args.json
        ? json({ status: statusJson(status), report })
        : said(...reportLines(chosen.name, report));
    }
  }
}

export function runBoardsyncCli(
  args: BoardsyncCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  const slow = args.action === "link" || args.action === "sync-now";
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-boardsync",
    timeoutMs: options.timeoutMs ?? (slow ? SYNC_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    unsure: UNSURE,
    perform: async (daemon, note) => {
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
      if (args.action !== "status") return writeToProject(args, daemon, note);
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.target);
      if ("refusal" in chosen) return chosen.refusal;
      const status = await daemon.call("boardsync.status", { projectId: chosen.id });
      return args.json ? json(statusJson(status)) : said(...statusLines(chosen.name, status));
    },
  });
}
