/**
 * Issue #3734: `flightdeckd bg list`, the background sessions (`claude --bg`) of a host from a shell. The parser
 * in `args.ts` reads the words after the noun here; `--json` and `--host` are checked there with the other
 * commands'.
 */
import type { BgCliArgs } from "../../bg/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

/** `bg list`. */
export function readBg(args: CliArgs, reader: ArgReader): void {
  args.command = "bg";
  args.action = subAction(reader, ["list"] as const, "invalid bg action");
}

/** What the background sessions runner takes from the parsed arguments. */
export function bgCliArgs(args: CliArgs): BgCliArgs {
  return { action: "list", ...(args.json ? { json: true as const } : {}) };
}
