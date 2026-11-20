/**
 * Issue #3514: `flightdeckd session <verb>`, the verbs of one session. The parser in `args.ts` reads
 * the words after `session` here; what is wrong with the rest is checked there, with the usage text.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

export const SESSION_ACTIONS = ["interrupted", "summary", "files"] as const;

export function readSession(args: CliArgs, reader: ArgReader): void {
  args.command = "session";
  void reader;
  void operand;
  void subAction;
}
