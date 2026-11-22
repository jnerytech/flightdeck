/**
 * Issue #3701: `flightdeckd snapshots list|files`, `rewind preview` and `trace get|export`, the checkpoints and
 * the trace of a Claude session from a shell. The parser in `args.ts` reads the words after the noun here and
 * this file checks the flag; `--json` and `--host` are checked there with the other commands'. All take the
 * Claude session id, the one `session fork` and the history verbs take.
 */
import type { CheckpointsCliArgs } from "../../checkpoints/index.ts";
import type { TraceCliArgs } from "../../trace/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag } from "./flag-handlers.ts";

/** A turn number: a whole number from 0, the way `snapshots list` prints it. */
function turnOf(reader: ArgReader): number {
  const text = operand(reader, "the turn number");
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw invalid("invalid turn number", text);
  return Number(text);
}

/** `snapshots list <id>` or `snapshots files <id> <n>`. */
export function readSnapshots(args: CliArgs, reader: ArgReader): void {
  args.command = "snapshots";
  args.action = subAction(reader, ["list", "files"] as const, "invalid snapshots action");
  args.checkpointSession = operand(reader, "the Claude session id");
  if (args.action === "files") args.checkpointTurn = turnOf(reader);
}

/** `rewind preview <id> <turn>`, `rewind apply <id> <turn>` or `rewind undo <id> [--preview]`. */
export function readRewind(args: CliArgs, reader: ArgReader): void {
  args.command = "rewind";
  args.action = subAction(reader, ["preview", "apply", "undo"] as const, "invalid rewind action");
  args.checkpointSession = operand(reader, "the Claude session id");
  if (args.action !== "undo") args.checkpointTurn = turnOf(reader);
}

/** `trace get <id>` or `trace export <id> [--include-content]`. */
export function readTrace(args: CliArgs, reader: ArgReader): void {
  args.command = "trace";
  args.action = subAction(reader, ["get", "export"] as const, "invalid trace action");
  args.checkpointSession = operand(reader, "the Claude session id");
}

/** The flags only `trace export` and `rewind undo` take, for the parser's table of flags. */
export const CHECKPOINT_FLAGS: Record<string, Handler> = {
  "--include-content": setFlag((args) => {
    args.includeContent = true;
  }),
  "--preview": setFlag((args) => {
    args.undoPreview = true;
  }),
};

/** What is wrong with the flag, or undefined: `--include-content` belongs to `trace export` only, `--preview` to `rewind undo`. */
export function checkpointsProblem(args: CliArgs): string | undefined {
  if (args.undoPreview && !(args.command === "rewind" && args.action === "undo"))
    return "--preview: this flag only applies to flightdeckd rewind undo";
  if (args.command === "rewind") {
    if (args.undoPreview && args.confirm !== undefined)
      return "--preview: lists what rewind undo would change and takes no --confirm, since it writes nothing";
    const writes = args.action === "apply" || args.action === "undo";
    if (args.confirm !== undefined && !writes)
      return "--confirm: this flag only applies to flightdeckd rewind apply and undo";
    if (writes && !args.undoPreview && args.confirm === undefined)
      return `rewind ${args.action} needs --confirm, since it puts the files of the checkout back`;
  }
  if (args.includeContent && !(args.command === "trace" && args.action === "export"))
    return "--include-content: this flag only applies to flightdeckd trace export";
  return undefined;
}

/** What the checkpoints runner takes from the parsed arguments. */
export function checkpointsCliArgs(args: CliArgs): CheckpointsCliArgs {
  const json = args.json ? { json: true as const } : {};
  const session = args.checkpointSession ?? "";
  const turn = args.checkpointTurn ?? 0;
  if (args.action === "list") return { action: "list", session, ...json };
  if (args.action === "files") return { action: "files", session, n: turn, ...json };
  if (args.action === "apply") return { action: "apply", session, turn, ...json };
  if (args.action === "undo")
    return { action: args.undoPreview ? "undoPreview" : "undo", session, ...json };
  return { action: "preview", session, turn, ...json };
}

/** What the trace runner takes from the parsed arguments. */
export function traceCliArgs(args: CliArgs): TraceCliArgs {
  const json = args.json ? { json: true as const } : {};
  const session = args.checkpointSession ?? "";
  return args.action === "export"
    ? { action: "export", session, includeContent: args.includeContent === true, ...json }
    : { action: "get", session, ...json };
}
