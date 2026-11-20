/**
 * Issue #3538: `flightdeckd terminal <verb>`, the terminals a host keeps. The parser in `args.ts` reads
 * the words after `terminal` here; the flags are checked there, with the usage text. The verbs that
 * stream a terminal's output or type into it (`attach`, `write`, `resize`, `ack`, `detach`) belong to
 * the app's view and are not words of this noun.
 */
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const TERMINAL_ACTIONS = ["list"] as const;

/** `terminal list`: it takes no target. */
export function readTerminal(args: CliArgs, reader: ArgReader): void {
  args.command = "terminal";
  args.action = subAction(reader, TERMINAL_ACTIONS, "invalid terminal action");
}
