/**
 * Issue #3735: `flightdeckd external list|message|watch` and `flightdeckd names list`, the words after the
 * noun and the flags only they take.
 */
import type { ExternalCliArgs } from "../../central/index.ts";
import type { NamesCliArgs } from "../../names/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { SNIPPET_FLAGS } from "./snippet-args.ts";

const EXTERNAL_ACTIONS = ["list", "message", "watch"] as const;

export function readExternal(args: CliArgs, reader: ArgReader): void {
  args.command = "external";
  const action = subAction(reader, EXTERNAL_ACTIONS, "invalid external action");
  args.action = action;
  if (action === "message") args.externalSession = operand(reader, "the session (its Claude id)");
}

export function readNames(args: CliArgs, reader: ArgReader): void {
  args.command = "names";
  args.action = subAction(reader, ["list"] as const, "invalid names action");
}

/**
 * `--text` is `snippet save`'s and `external message`'s, and the parser's table holds one handler per flag: the
 * command names the reading. Any other command gets the snippet one, whose check says where the flag belongs.
 */
export const TEXT_FLAG: Handler = (args, reader, value) => {
  if (args.command === "external") args.text = value();
  else SNIPPET_FLAGS["--text"]?.(args, reader, value);
};

/** What is wrong with the `external` words and flags, or undefined: the text is the verb `message`'s, and is not empty. */
export function externalProblem(args: CliArgs): string | undefined {
  if (args.command !== "external") return undefined;
  if (args.action !== "message")
    return args.text === undefined
      ? undefined
      : "--text: this flag only applies to flightdeckd external message";
  if (args.text === undefined) return "external message: missing --text <text>";
  if (args.text.trim() === "") return "--text: the message cannot be empty";
  return undefined;
}

export function externalCliArgs(args: CliArgs): ExternalCliArgs {
  const json = args.json ? { json: true as const } : {};
  if (args.action === "message")
    return {
      action: "message",
      session: args.externalSession ?? "",
      text: args.text ?? "",
      ...json,
    };
  return { action: args.action === "watch" ? "watch" : "list", ...json };
}

export function namesCliArgs(args: CliArgs): NamesCliArgs {
  return { action: "list", ...(args.json ? { json: true as const } : {}) };
}
