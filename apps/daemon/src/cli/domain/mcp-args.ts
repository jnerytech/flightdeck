/**
 * Issue #3616: `flightdeckd mcp <verb>`, a project's MCP servers from a shell. A bare `mcp` is still the
 * stdio server that Claude Code launches, so a verb is a word after it and a flag never is one. The parser
 * in `args.ts` reads the words here; `--json` and `--host` are checked there with the other commands', and
 * refused here on the server, which has no use for them.
 */
import type { McpCliArgs } from "../../agentcfg/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { USAGE } from "./usage.ts";

const MCP_ACTIONS = ["list", "status", "test", "save", "remove", "toggle"] as const;

/**
 * `mcp` (the server), `mcp list <project>`, `mcp status <session>`, `mcp test|remove <project> <server> --confirm`,
 * `mcp save <project> <file or -> --confirm` or `mcp toggle <project> <server> --enable|--disable`.
 */
export function readMcp(args: CliArgs, reader: ArgReader): void {
  args.command = "mcp";
  const next = reader.peek();
  // No word, or a flag (`--config`): the server.
  if (next === undefined || next.startsWith("--")) return;
  const verb = subAction(reader, MCP_ACTIONS, "invalid mcp action");
  args.action = verb;
  args.mcpWords = [operand(reader, verb === "status" ? "the session" : "the project")];
  if (verb === "save") args.mcpWords.push(operand(reader, "the file (or - for stdin)"));
  else if (verb !== "list" && verb !== "status") args.mcpWords.push(operand(reader, "the server"));
}

/**
 * `--enable`, `--disable`, `--session` and `--confirm` are other commands' flags too: on `mcp` the switch moves
 * into a field of its own, so the terminal's check does not read it.
 */
export function takeMcpFlags(args: CliArgs): void {
  if (args.command !== "mcp") return;
  if (args.terminalEnable && args.terminalDisable)
    throw new Error(`--enable or --disable, not both\n${USAGE}`);
  if (args.terminalEnable || args.terminalDisable) args.mcpEnabled = args.terminalEnable === true;
  delete args.terminalEnable;
  delete args.terminalDisable;
}

const CONFIRMED = ["test", "save", "remove", "toggle"];
const ONLY = "this flag only applies to flightdeckd mcp";

/** What is wrong with the `mcp` flags and verbs: each flag belongs to its verbs, and the server takes none. */
export function mcpProblem(args: CliArgs): string | undefined {
  if (args.command !== "mcp") return undefined;
  const verb = args.action;
  const switchFlag = args.mcpEnabled ? "--enable" : "--disable";
  if (args.confirm !== undefined && !CONFIRMED.includes(verb ?? ""))
    return `--confirm: ${ONLY} test, remove, save and toggle`;
  if (args.session !== undefined && verb !== "toggle") return `--session: ${ONLY} toggle`;
  if (args.mcpEnabled !== undefined && verb !== "toggle") return `${switchFlag}: ${ONLY} toggle`;
  if (verb === undefined) {
    if (args.json) return "--json: this flag only applies to flightdeckd mcp list, status and test";
    if (args.host !== undefined)
      return "--host: this flag only applies to flightdeckd mcp list, status and test";
  }
  if (verb === "remove" && !args.confirm)
    return "mcp remove deletes the server from the project's .mcp.json: pass --confirm";
  if (verb === "save" && !args.confirm)
    return "mcp save writes a server into the project's .mcp.json, a command its sessions run: pass --confirm";
  if (verb !== "toggle") return undefined;
  if (args.mcpEnabled === undefined) return "mcp toggle needs --enable or --disable";
  if (args.mcpEnabled && !args.confirm)
    return "mcp toggle --enable lets the server run in the project's sessions: pass --confirm";
  if (!args.mcpEnabled && args.confirm) return "--confirm: only with mcp toggle --enable";
  return undefined;
}

/** What the mcp runner takes from the parsed arguments (checked by `readMcp`). */
export function mcpCliArgs(args: CliArgs): McpCliArgs {
  const json = args.json ? { json: true as const } : {};
  const [target = "", second = ""] = args.mcpWords ?? [];
  if (args.action === "test")
    return {
      action: "test",
      project: target,
      server: second,
      ...(args.confirm ? { confirm: true as const } : {}),
      ...json,
    };
  if (args.action === "save") return { action: "save", project: target, file: second, ...json };
  if (args.action === "remove")
    return { action: "remove", project: target, server: second, ...json };
  if (args.action === "toggle")
    return {
      action: "toggle",
      project: target,
      server: second,
      enabled: args.mcpEnabled === true,
      ...(args.session === undefined ? {} : { session: args.session }),
      ...json,
    };
  if (args.action === "status") return { action: "status", session: target, ...json };
  return { action: "list", project: target, ...json };
}
