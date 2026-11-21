/**
 * Issue #3623: `flightdeckd knowledge <verb>`, a project's document library from a shell. The parser in
 * `args.ts` reads the words after `knowledge` here; `--json` and `--host` are checked there with the other
 * commands'. `--status`, `--on` and `--off` are other commands' flags too (`message history`, `boardsync set-push`,
 * `snippet favorite`) and the parser's table holds one handler per flag: `knowledgeFlags` names the reading by
 * the command. `--hash` and `--body-file` are shared the same way but need no choice: both are plain values.
 */
import { KnowledgeKind, KnowledgeStatus } from "@flightdeck/protocol";
import type { KnowledgeCliArgs } from "../../knowledge/index.ts";
import { type ArgReader, FLAGS, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { oneOf } from "./vault-args.ts";

const KNOWLEDGE_ACTIONS = ["list", "index", "feed", "set-status", "create", "set-feed"] as const;

/** The title the daemon takes (`knowledge.create`). */
const TITLE_MAX = 200;

/**
 * `knowledge list|index|feed <project>`, `set-status <project> <file>` and `create <project> <kind> <title>`:
 * a project is its name or id, or its folder.
 */
export function readKnowledge(args: CliArgs, reader: ArgReader): void {
  args.command = "knowledge";
  const verb = subAction(reader, KNOWLEDGE_ACTIONS, "invalid knowledge action");
  args.action = verb;
  args.knowledgeProject = operand(reader, "the project");
  if (verb === "set-status") args.knowledgeFile = operand(reader, "the file");
  if (verb === "create") {
    const kind = operand(reader, "the kind");
    if (!KnowledgeKind.safeParse(kind).success)
      throw invalid(`invalid knowledge kind (${KnowledgeKind.options.join(", ")})`, kind);
    args.knowledgeKind = kind as KnowledgeKind;
    args.knowledgeTitle = operand(reader, "the title");
  }
}

const BOTH = "--on or --off, not both";

/** What the knowledge verbs read of the flags they share, and what the other commands keep reading. */
const own: Record<string, Handler> = {
  "--status": (args, _reader, value) => {
    args.knowledgeStatus = oneOf("--status", value(), KnowledgeStatus.options);
  },
  "--on": (args) => {
    if (args.knowledgeFeed === false) throw new Error(BOTH);
    args.knowledgeFeed = true;
  },
  "--off": (args) => {
    if (args.knowledgeFeed === true) throw new Error(BOTH);
    args.knowledgeFeed = false;
  },
};

/**
 * `--status`, `--on` and `--off` for the parser's table: `knowledge` reads them as its own, and any other
 * command gets the handler it had (`others`), whose check says where the flag belongs.
 */
export function knowledgeFlags(others: Record<string, Handler>): Record<string, Handler> {
  const pick = (flag: string): Handler => {
    const handler: Handler = (args, reader, value) =>
      (args.command === "knowledge" ? own : others)[flag]?.(args, reader, value);
    // `--on` and `--off` take no value; whether another command's handler is one decides it for the pair.
    if (flag !== "--status") FLAGS.add(handler);
    return handler;
  };
  return { "--status": pick("--status"), "--on": pick("--on"), "--off": pick("--off") };
}

const ONLY = "this flag only applies to flightdeckd knowledge";

/** What is wrong with the knowledge flags and verbs, or undefined; the other commands never carry them. */
export function knowledgeProblem(args: CliArgs): string | undefined {
  if (args.command !== "knowledge") return undefined;
  const verb = args.action;
  const feedFlag = args.knowledgeFeed ? "--on" : "--off";
  if (args.knowledgeStatus !== undefined && verb !== "set-status")
    return `--status: ${ONLY} set-status`;
  if (args.hash !== undefined && verb !== "set-status") return `--hash: ${ONLY} set-status`;
  if (args.knowledgeFeed !== undefined && verb !== "set-feed")
    return `${feedFlag}: ${ONLY} set-feed`;
  if (args.bodyFile !== undefined && verb !== "create") return `--body-file: ${ONLY} create`;
  if (verb === "set-status" && args.knowledgeStatus === undefined)
    return "knowledge set-status needs --status";
  if (verb === "set-status" && args.hash === undefined) return "knowledge set-status needs --hash";
  if (verb === "set-feed" && args.knowledgeFeed === undefined)
    return "knowledge set-feed needs --on or --off";
  if (verb === "create" && (args.knowledgeTitle ?? "").length > TITLE_MAX)
    return `knowledge create: the title is longer than ${TITLE_MAX} characters`;
  return undefined;
}

/** What the knowledge runner takes from the parsed arguments (checked by `readKnowledge` and `knowledgeProblem`). */
export function knowledgeCliArgs(args: CliArgs): KnowledgeCliArgs {
  return {
    action: args.action as KnowledgeCliArgs["action"],
    project: args.knowledgeProject ?? "",
    ...(args.json ? { json: true as const } : {}),
    ...(args.knowledgeFile === undefined ? {} : { file: args.knowledgeFile }),
    ...(args.knowledgeStatus === undefined ? {} : { status: args.knowledgeStatus }),
    ...(args.action === "set-status" && args.hash !== undefined ? { hash: args.hash } : {}),
    ...(args.knowledgeKind === undefined ? {} : { kind: args.knowledgeKind }),
    ...(args.knowledgeTitle === undefined ? {} : { title: args.knowledgeTitle }),
    ...(args.bodyFile === undefined ? {} : { bodyFile: args.bodyFile }),
    ...(args.knowledgeFeed === undefined ? {} : { enabled: args.knowledgeFeed }),
  };
}
