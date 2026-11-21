/**
 * Issue #3618: what the `memory` verbs of the CLI take. The parser in `args.ts` reads the words after
 * `memory` here; `--json` and `--host` are checked there with the others'.
 */
import type { MemoryCliArgs } from "../../memory/index.ts";
import { SHA256 } from "./agentcfg-args.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const MEMORY_ACTIONS = ["list", "read", "budget", "suggest", "write", "delete"] as const;

/** `memory list|budget|suggest <project>` and `memory read <project> <name>`. */
export function readMemory(args: CliArgs, reader: ArgReader): void {
  args.command = "memory";
  args.action = subAction(reader, MEMORY_ACTIONS, "invalid memory action");
  args.memoryProject = operand(reader, "the project");
  if (args.action === "read" || args.action === "write" || args.action === "delete")
    args.memoryName = operand(reader, "the file name");
}

/** Every flag of the write verbs, whether it was typed, and the verbs that take it. */
const flagged = (args: CliArgs): Array<[string, boolean, readonly string[]]> => [
  ["--file", args.agentcfgFile !== undefined, ["write"]],
  ["--new", args.agentcfgNew === true, ["write"]],
  ["--expected-hash", args.agentcfgHash !== undefined, ["write", "delete"]],
  ["--confirm", args.confirm !== undefined, ["write", "delete"]],
];

/** The hash and `--confirm` a write or a delete needs, and for a write where its content comes from. */
function writeProblem(args: CliArgs): string | undefined {
  const verb = `memory ${args.action}`;
  const hash = args.agentcfgHash;
  if (args.action === "write" && args.agentcfgFile === undefined)
    return `${verb}: missing --file <path> (or --file - for standard input)`;
  if (hash !== undefined && args.agentcfgNew)
    return `${verb}: --expected-hash and --new cannot go together`;
  if (hash === undefined && (args.action === "delete" || !args.agentcfgNew))
    return `${verb}: missing --expected-hash <hash> (the one memory read printed)${args.action === "write" ? ", or --new for a file that must not exist yet" : ""}`;
  if (hash !== undefined && !SHA256.test(hash))
    return "--expected-hash: a sha256 hash of 64 hex digits, as memory read prints it";
  if (args.confirm !== true)
    return `${verb}: needs --confirm, since it changes a note every later session of the project loads`;
  return undefined;
}

/** What is wrong with the `memory` flags: one outside the verbs that take it, or a write or delete that lacks its hash or `--confirm`. */
export function memoryProblem(args: CliArgs): string | undefined {
  if (args.command !== "memory") return undefined;
  for (const [flag, typed, verbs] of flagged(args))
    if (typed && !verbs.includes(args.action ?? ""))
      return `${flag}: on memory this flag only applies to ${verbs.join(" and ")}`;
  return args.action === "write" || args.action === "delete" ? writeProblem(args) : undefined;
}

/** What the memory runner takes from the parsed arguments. */
export function memoryCliArgs(args: CliArgs): MemoryCliArgs {
  const common = {
    project: args.memoryProject ?? "",
    ...(args.json ? { json: true as const } : {}),
  };
  const name = args.memoryName ?? "";
  if (args.action === "read") return { ...common, action: "read", name };
  if (args.action === "write")
    return {
      ...common,
      action: "write",
      name,
      file: args.agentcfgFile ?? "",
      expectedHash: args.agentcfgHash ?? null,
      confirm: true,
    };
  if (args.action === "delete")
    return {
      ...common,
      action: "delete",
      name,
      expectedHash: args.agentcfgHash ?? "",
      confirm: true,
    };
  return { ...common, action: args.action as "list" | "budget" | "suggest" };
}
