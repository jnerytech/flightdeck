/**
 * Issue #3540: `flightdeckd boardsync <verb>`, a project's GitHub Projects board sync from a shell.
 * The parser in `args.ts` reads the words after `boardsync` here and this file checks the flags, with the
 * usage text added there; `--json` and `--host` are checked there with the other commands'. `--on`,
 * `--off` and `--map` move into fields of their own, so no other command's check reads them.
 */
import { BoardColumn } from "@flightdeck/protocol";
import type { BoardsyncCliArgs } from "../../boardsync/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";

const BOARDSYNC_ACTIONS = [
  "boards",
  "status",
  "log",
  "link",
  "unlink",
  "set-map",
  "set-push",
  "sync-now",
] as const;

/**
 * `boardsync boards`, `status|unlink|set-map|set-push|sync-now <project>`, `link <project> <board>` or
 * `log <card>`.
 */
export function readBoardsync(args: CliArgs, reader: ArgReader): void {
  args.command = "boardsync";
  const verb = subAction(reader, BOARDSYNC_ACTIONS, "invalid boardsync action");
  args.action = verb;
  // `boards` lists the account's boards and takes no operand.
  if (verb === "boards") return;
  args.boardsyncTarget = operand(reader, verb === "log" ? "the card" : "the project");
  if (verb === "link") args.boardsyncBoard = operand(reader, "the board");
}

const MAP_SHAPE = '--map: needs <status>=<column>, like "Todo=backlog"';

/** `--map <status>=<column>`, split on the last `=` since a status may hold one; each status once. */
const mapPair = setValue((args, value) => {
  const at = value.lastIndexOf("=");
  const status = value.slice(0, at);
  const column = value.slice(at + 1);
  if (at < 1 || column === "") throw new Error(MAP_SHAPE);
  const known = BoardColumn.safeParse(column);
  if (!known.success)
    throw new Error(`--map: the column is one of ${BoardColumn.options.join(", ")}`);
  // No prototype: a status named `__proto__` is a key like the rest.
  args.boardsyncMap ??= Object.create(null) as Record<string, BoardColumn>;
  const map = args.boardsyncMap;
  if (Object.hasOwn(map, status)) throw new Error(`--map: the status ${status} is given twice`);
  map[status] = known.data;
});

const BOTH = "--on or --off, not both";

/** The flags of the boardsync verbs; each verb takes its own, checked in `boardsyncProblem`. */
export const BOARDSYNC_FLAGS: Record<string, Handler> = {
  "--map": mapPair,
  "--on": setFlag((args) => {
    if (args.boardsyncPush === false) throw new Error(BOTH);
    args.boardsyncPush = true;
  }),
  "--off": setFlag((args) => {
    if (args.boardsyncPush === true) throw new Error(BOTH);
    args.boardsyncPush = false;
  }),
};

const ONLY = "this flag only applies to flightdeckd boardsync";

/** What is wrong with the boardsync flags and verbs, or undefined; the other commands may not carry them. */
export function boardsyncProblem(args: CliArgs): string | undefined {
  const verb = args.command === "boardsync" ? args.action : undefined;
  const pushFlag = args.boardsyncPush ? "--on" : "--off";
  if (args.boardsyncMap !== undefined && verb !== "link" && verb !== "set-map")
    return `--map: ${ONLY} link and set-map`;
  if (args.boardsyncPush !== undefined && verb !== "set-push")
    return `${pushFlag}: ${ONLY} set-push`;
  if (args.command !== "boardsync") return undefined;
  if (verb === "set-map" && args.boardsyncMap === undefined)
    return "boardsync set-map needs a --map";
  if (verb === "set-push" && args.boardsyncPush === undefined)
    return "boardsync set-push needs --on or --off";
  if (args.confirm && !(verb === "set-push" && args.boardsyncPush === true))
    return `--confirm: ${ONLY} set-push --on`;
  return undefined;
}

/** What the boardsync runner takes from the parsed arguments. */
export function boardsyncCliArgs(args: CliArgs): BoardsyncCliArgs {
  const json = args.json ? { json: true as const } : {};
  const target = args.boardsyncTarget ?? "";
  switch (args.action) {
    case "link":
      return {
        action: "link",
        target,
        boardId: args.boardsyncBoard ?? "",
        ...(args.boardsyncMap ? { columnMap: args.boardsyncMap } : {}),
        ...json,
      };
    case "set-map":
      return { action: "set-map", target, columnMap: args.boardsyncMap ?? {}, ...json };
    case "set-push":
      return {
        action: "set-push",
        target,
        push: args.boardsyncPush === true,
        ...(args.confirm ? { confirm: true } : {}),
        ...json,
      };
    case "boards":
      return { action: "boards", ...json };
    default:
      return { action: args.action as "status" | "log" | "unlink" | "sync-now", target, ...json };
  }
}
