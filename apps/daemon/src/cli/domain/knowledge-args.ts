/**
 * Issue #3623: `flightdeckd knowledge <verb>`, a project's document library from a shell. The parser in
 * `args.ts` reads the words after `knowledge` here; `--json` and `--host` are checked there with the other
 * commands'.
 */
import type { KnowledgeCliArgs } from "../../knowledge/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const KNOWLEDGE_ACTIONS = ["list", "index", "feed"] as const;

/** `knowledge list|index|feed <project>`: a project's name or id, or its folder. */
export function readKnowledge(args: CliArgs, reader: ArgReader): void {
  args.command = "knowledge";
  const verb = subAction(reader, KNOWLEDGE_ACTIONS, "invalid knowledge action");
  args.action = verb;
  args.knowledgeProject = operand(reader, "the project");
}

/** What the knowledge runner takes from the parsed arguments (checked by `readKnowledge`). */
export function knowledgeCliArgs(args: CliArgs): KnowledgeCliArgs {
  return {
    action: args.action as KnowledgeCliArgs["action"],
    project: args.knowledgeProject ?? "",
    ...(args.json ? { json: true as const } : {}),
  };
}
