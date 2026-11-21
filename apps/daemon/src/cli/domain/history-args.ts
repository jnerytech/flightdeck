/**
 * Issue #3461: what the `history` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names. The ranges are the protocol's.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { USAGE } from "./usage.ts";

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface HistoryArgs {
  command: string;
  action?: string;
  cwd?: string;
  projectKey?: string;
  from?: string;
  until?: string;
  origin?: string;
  hideAutomated?: boolean;
  limit?: number;
  cursor?: string;
  tail?: boolean;
  /** `--name` is the persona's too: `personaName`. */
  personaName?: string;
  permissionMode?: string;
  force?: boolean;
  json?: boolean;
}

/** The verbs that print JSON for a script (`reindex` prints a sentence). */
const JSON_VERBS = new Set(["list", "search", "get", "tool", "resume", "watch"]);

/** The flags of `history`, each with the verbs that take it (`--from` is `update`'s, `--name` the persona's, `--force` the card's and `--limit` `autoapprove`'s too: only `history` is checked). */
function historyFlags(args: HistoryArgs): Array<[string, unknown, readonly string[]]> {
  return [
    ["--cwd", args.cwd, ["list", "search"]],
    ["--project-key", args.projectKey, ["list"]],
    ["--to", args.until, ["list", "search"]],
    ["--origin", args.origin, ["list"]],
    ["--hide-automated", args.hideAutomated, ["list"]],
    ["--cursor", args.cursor, ["list", "get"]],
    ["--tail", args.tail, ["get"]],
    ...(args.command === "history"
      ? ([
          ["--from", args.from, ["list", "search"]],
          ["--name", args.personaName, ["resume"]],
          ["--permission-mode", args.permissionMode, ["resume"]],
          ["--force", args.force, ["resume"]],
          ["--limit", args.limit, ["list", "search", "get"]],
        ] as Array<[string, unknown, readonly string[]]>)
      : []),
  ];
}

/** A flag of another verb: `costs` and `roi` take `--to` and `--origin` too, checked by `costsProblem`. */
function historyStrayFlag(args: HistoryArgs): string | undefined {
  for (const [flag, value, verbs] of historyFlags(args)) {
    if (value === undefined) continue;
    if (
      (flag === "--to" || flag === "--origin") &&
      (args.command === "costs" || args.command === "roi" || args.command === "agentcfg")
    )
      continue;
    if (args.command !== "history" || !verbs.includes(args.action as string))
      return `${flag}: this flag only applies to flightdeckd history ${verbs.join(", ")}`;
  }
  return undefined;
}

/** What is wrong with the `history` flags: one of another verb, or a value outside what the daemon takes. */
export function historyProblem(args: HistoryArgs): string | undefined {
  const stray = historyStrayFlag(args);
  if (stray !== undefined) return stray;
  if (args.command !== "history") return undefined;
  if (args.json && !JSON_VERBS.has(args.action as string))
    return "--json: this flag only applies to flightdeckd history list, search, get, tool, resume and watch";
  if (args.origin !== undefined && args.origin !== "flightdeck" && args.origin !== "external")
    return "--origin: flightdeck or external";
  if (args.tail && args.cursor !== undefined)
    return "--tail: a tail opens on the last messages, without --cursor";
  const most = args.action === "get" ? 500 : 200;
  if (args.limit !== undefined && args.limit > most) return `--limit: at most ${most}`;
  return undefined;
}

/** `history reindex|list|search|get|tool|resume|watch`: the command word and the operands of each verb. */
export function readHistory(args: CliArgs, reader: ArgReader): void {
  args.command = "history";
  const action = subAction(
    reader,
    ["reindex", "list", "search", "get", "tool", "resume", "watch"] as const,
    "invalid history action",
  );
  args.action = action;
  if (action === "search") args.query = operand(reader, "the text");
  if (action === "get" || action === "tool" || action === "resume")
    args.claudeSessionId = operand(reader, "the session");
  if (action === "tool") {
    args.uuid = operand(reader, "the message");
    const word = operand(reader, "the tool call index");
    const index = /^\d{1,4}$/.test(word) ? Number(word) : -1;
    if (index < 0 || index > 1000)
      throw new Error(`history tool: the index is a whole number from 0 to 1000\n${USAGE}`);
    args.index = index;
  }
}
