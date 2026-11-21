/**
 * Issue #3618: what the `memory` verbs of the CLI take. The parser in `args.ts` reads the words after
 * `memory` here; `--json` and `--host` are checked there with the others'.
 */
import type { MemoryCliArgs } from "../../memory/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const MEMORY_ACTIONS = ["list", "read", "budget", "suggest"] as const;

/** `memory list|budget|suggest <project>` and `memory read <project> <name>`. */
export function readMemory(args: CliArgs, reader: ArgReader): void {
  args.command = "memory";
  args.action = subAction(reader, MEMORY_ACTIONS, "invalid memory action");
  args.memoryProject = operand(reader, "the project");
  if (args.action === "read") args.memoryName = operand(reader, "the file name");
}

/** What the memory runner takes from the parsed arguments. */
export function memoryCliArgs(args: CliArgs): MemoryCliArgs {
  const common = {
    project: args.memoryProject ?? "",
    ...(args.json ? { json: true as const } : {}),
  };
  return args.action === "read"
    ? { ...common, action: "read", name: args.memoryName ?? "" }
    : { ...common, action: args.action as "list" | "budget" | "suggest" };
}
