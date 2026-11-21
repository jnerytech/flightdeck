/**
 * Issue #3735: `flightdeckd external list|message|watch` and `flightdeckd names list`, the words after the
 * noun and the flags only they take.
 */
import type { ExternalCliArgs } from "../../central/index.ts";
import type { NamesCliArgs } from "../../names/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { SNIPPET_FLAGS } from "./snippet-args.ts";

const EXTERNAL_ACTIONS = ["list", "message", "watch"] as const;

export function readExternal(args: CliArgs, reader: ArgReader): void {
  args.command = "external";
  args.action = subAction(reader, EXTERNAL_ACTIONS, "invalid external action");
}

export function readNames(args: CliArgs, reader: ArgReader): void {
  args.command = "names";
  args.action = subAction(reader, ["list"] as const, "invalid names action");
}

/** `--text` is `snippet save`'s too: on `external` it is the message. */
export const TEXT_FLAG: Handler = (args, reader, value) =>
  args.command === "external" ? undefined : SNIPPET_FLAGS["--text"]?.(args, reader, value);

export function externalProblem(_args: CliArgs): string | undefined {
  return undefined;
}

export function externalCliArgs(_args: CliArgs): ExternalCliArgs {
  return { action: "list" };
}

export function namesCliArgs(_args: CliArgs): NamesCliArgs {
  return { action: "list" };
}
