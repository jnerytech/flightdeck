/**
 * Issue #3624: `flightdeckd file <verb>`, the files of a target's repository and the folders of a host, from a
 * shell. The parser in `args.ts` reads the words after `file` here and this file checks the flags; `--json` and
 * `--host` are checked there with the other commands'. `--dir`, `--query` and `--limit` are other commands' flags
 * too: on `file` they move into fields of its own, so no other command's check reads them.
 */
import type { FileCliArgs } from "../../files/index.ts";
import type { ArgReader } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";

/** `file list|read|search <target> ...` or `file dirs|files [<path>]`. */
export function readFile(args: CliArgs, _reader: ArgReader): void {
  args.command = "file";
}

/** The flags only `file` verbs take, for the parser's table of flags. */
export const FILE_FLAGS: Record<string, Handler> = {};

export function takeFileFlags(_args: CliArgs): void {}

/** What is wrong with the `file` flags, or undefined. */
export function fileProblem(_args: CliArgs): string | undefined {
  return undefined;
}

/** What the file runner takes from the parsed arguments. */
export function fileCliArgs(_args: CliArgs): FileCliArgs {
  return { action: "dirs" };
}
