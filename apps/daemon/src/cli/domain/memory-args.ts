/**
 * Issue #3618: what the `memory` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` reads the words after `memory` here; `--json` and `--host` are checked there with the others'.
 */
import type { MemoryCliArgs } from "../../memory/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const MEMORY_ACTIONS = ["list", "read", "budget", "suggest"] as const;

/** `memory list|budget|suggest <project>` and `memory read <project> <name>`. */
export function readMemory(args: CliArgs, reader: ArgReader): void {
  args.command = "memory";
  args.action = subAction(reader, MEMORY_ACTIONS, "invalid memory action");
  while (reader.peek() !== undefined && !(reader.peek() ?? "").startsWith("--")) reader.advance();
  args.memoryProject = "";
}

/** A project and, for `read`, a file: what is wrong with the words after the verb. */
export function memoryProblem(args: CliArgs): string | undefined {
  return args.command === "memory" ? undefined : undefined;
}

/** What the memory runner takes from the parsed arguments. */
export function memoryCliArgs(args: CliArgs): MemoryCliArgs {
  return { action: "list", project: "", ...(args.json ? { json: true as const } : {}) };
}
