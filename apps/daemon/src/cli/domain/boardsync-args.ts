/**
 * Issue #3540: `flightdeckd boardsync <verb>`, a project's GitHub Projects board sync from a shell.
 * The parser in `args.ts` reads the words after `boardsync` here; `--json` and `--host` are checked there
 * with the other commands'.
 */
import type { BoardsyncCliArgs } from "../../boardsync/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const BOARDSYNC_ACTIONS = ["boards", "status", "log"] as const;

/** `boardsync boards`, `boardsync status <project>` or `boardsync log <card>`. */
export function readBoardsync(args: CliArgs, reader: ArgReader): void {
  args.command = "boardsync";
  const verb = subAction(reader, BOARDSYNC_ACTIONS, "invalid boardsync action");
  args.action = verb;
  // `boards` lists the account's boards and takes no operand.
  if (verb === "status") args.boardsyncTarget = operand(reader, "the project");
  if (verb === "log") args.boardsyncTarget = operand(reader, "the card");
}

/** What the boardsync runner takes from the parsed arguments. */
export function boardsyncCliArgs(args: CliArgs): BoardsyncCliArgs {
  const json = args.json ? { json: true as const } : {};
  const action = args.action as BoardsyncCliArgs["action"];
  return action === "boards"
    ? { action, ...json }
    : { action, target: args.boardsyncTarget ?? "", ...json };
}
