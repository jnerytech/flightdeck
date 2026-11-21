/**
 * Issue #3616: `flightdeckd mcp <verb>`, a project's MCP servers from a shell. A bare `mcp` is still the
 * stdio server that Claude Code launches, so a verb is a word after it and a flag never is one. The parser
 * in `args.ts` reads the words here; `--json` and `--host` are checked there with the other commands', and
 * refused here on the server, which has no use for them.
 */
import type { McpCliArgs } from "../../agentcfg/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const MCP_ACTIONS = ["list", "status", "test"] as const;

/** `mcp` (the server), `mcp list <project>`, `mcp status <session>` or `mcp test <project> <server>`. */
export function readMcp(args: CliArgs, reader: ArgReader): void {
  args.command = "mcp";
  const next = reader.peek();
  // No word, or a flag (`--config`): the server.
  if (next === undefined || next.startsWith("--")) return;
  const verb = subAction(reader, MCP_ACTIONS, "invalid mcp action");
  args.action = verb;
  args.mcpWords = [operand(reader, verb === "status" ? "the session" : "the project")];
  if (verb === "test") args.mcpWords.push(operand(reader, "the server"));
}

/** What is wrong with the `mcp` flags: the server takes none of the verbs' flags. */
export function mcpProblem(args: CliArgs): string | undefined {
  if (args.command !== "mcp" || args.action !== undefined) return undefined;
  if (args.json) return "--json: this flag only applies to flightdeckd mcp list, status and test";
  if (args.host !== undefined)
    return "--host: this flag only applies to flightdeckd mcp list, status and test";
  return undefined;
}

/** What the mcp runner takes from the parsed arguments (checked by `readMcp`). */
export function mcpCliArgs(args: CliArgs): McpCliArgs {
  const json = args.json ? { json: true as const } : {};
  const [target = "", server = ""] = args.mcpWords ?? [];
  if (args.action === "test") return { action: "test", project: target, server, ...json };
  if (args.action === "status") return { action: "status", session: target, ...json };
  return { action: "list", project: target, ...json };
}
