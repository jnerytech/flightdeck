/**
 * Issue #3514: `flightdeckd session <verb>`, the verbs of one session. The parser in `args.ts` reads
 * the words after `session` here; the flags are checked there, with the usage text.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const SESSION_ACTIONS = ["interrupted", "summary", "files"] as const;

/** `session interrupted`, or `session summary|files <session>` (the session is its name or its id). */
export function readSession(args: CliArgs, reader: ArgReader): void {
  args.command = "session";
  const action = subAction(reader, SESSION_ACTIONS, "invalid session action");
  args.action = action;
  if (action !== "interrupted") args.sessionRef = operand(reader, "the session");
}
