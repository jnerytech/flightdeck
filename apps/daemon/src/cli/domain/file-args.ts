/**
 * Issue #3624: `flightdeckd file <verb>`, the files of a target's repository and the folders of a host, from a
 * shell. The parser in `args.ts` reads the words after `file` here and this file checks the flags; `--json` and
 * `--host` are checked there with the other commands'. `--dir`, `--query` and `--limit` are other commands' flags
 * too: on `file` they move into fields of its own, so no other command's check reads them.
 */
import { posix, win32 } from "node:path";
import { ReviewTarget } from "@flightdeck/protocol";
import type { FileCliArgs } from "../../files/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const FILE_ACTIONS = ["list", "read", "write", "search", "dirs", "files"] as const;
/** The most characters of a search text and the most matches, as the daemon takes them. */
const MOST_QUERY = 200;
const MOST_MATCHES = 200;
const SHA256 = /^[0-9a-f]{64}$/;

/** `file list|read|search <target> ...`, `file dirs [<path>]` or `file files <path>`. */
export function readFile(args: CliArgs, reader: ArgReader): void {
  args.command = "file";
  const verb = subAction(reader, FILE_ACTIONS, "invalid file action");
  args.action = verb;
  if (verb === "dirs" || verb === "files") {
    // `dirs` alone lists the roots the host allows; a flag next is not its folder.
    const next = reader.peek();
    if (verb === "files" || (next !== undefined && !next.startsWith("--")))
      args.filePath = operand(reader, "the folder");
    return;
  }
  const target = operand(reader, "the target");
  if (!ReviewTarget.safeParse(target).success) throw invalid("invalid target", target);
  args.fileTarget = target;
  if (verb === "read" || verb === "write") args.filePath = operand(reader, "the file");
}

/** The flags only `file` verbs take, for the parser's table of flags. */
export const FILE_FLAGS: Record<string, Handler> = {
  "--mode": setValue((args, value) => {
    if (value !== "name" && value !== "content")
      throw new Error(`--mode: name or content, got ${value}\n${USAGE}`);
    args.fileMode = value;
  }),
  "--hidden": setFlag((args) => {
    args.fileHidden = true;
  }),
};

/** On `file` the flags the other commands read move into fields of its own (the plugin's folder, the snippet query). */
export function takeFileFlags(args: CliArgs): void {
  if (args.command !== "file") return;
  const moved = {
    fileDir: args.pluginDir,
    fileQuery: args.query,
    fileLimit: args.limit,
    fileText: args.agentcfgFile,
    fileHash: args.hash,
    fileConfirm: args.confirm,
  };
  for (const [field, value] of Object.entries(moved))
    if (value !== undefined) Object.assign(args, { [field]: value });
  delete args.pluginDir;
  delete args.query;
  delete args.limit;
  delete args.agentcfgFile;
  delete args.hash;
  delete args.confirm;
}

/** Each flag, whether it was typed, and the verbs that take it. */
const flagged = (args: CliArgs): Array<[string, boolean, readonly string[]]> => [
  ["--dir", args.fileDir !== undefined, ["list"]],
  ["--query", args.fileQuery !== undefined, ["search"]],
  ["--mode", args.fileMode !== undefined, ["search"]],
  ["--limit", args.fileLimit !== undefined, ["search"]],
  ["--hidden", args.fileHidden !== undefined, ["dirs", "files"]],
  ["--file", args.fileText !== undefined, ["write"]],
  ["--hash", args.fileHash !== undefined, ["write"]],
  ["--confirm", args.fileConfirm !== undefined, ["write"]],
];

/** What is wrong with a search: the flags it needs, and the text and limit the daemon would refuse. */
function searchProblem(args: CliArgs): string | undefined {
  if (args.fileMode === undefined) return "file search needs --mode name or content";
  const query = args.fileQuery;
  if (query === undefined) return "file search needs --query";
  if (query.length < 1 || query.length > MOST_QUERY)
    return `--query: 1 to ${MOST_QUERY} characters`;
  if (/\p{Cc}/u.test(query)) return "--query: no control character";
  if (args.fileLimit !== undefined && args.fileLimit > MOST_MATCHES)
    return `--limit: at most ${MOST_MATCHES}`;
  return undefined;
}

/** What `file write` needs besides its target and path: where the text comes from, the version it replaces, and `--confirm`. */
function writeProblem(args: CliArgs): string | undefined {
  if (args.fileText === undefined)
    return "file write: missing --file <path> (or --file - for standard input)";
  if (args.fileHash === undefined)
    return "file write: missing --hash <hash> (the one file read printed)";
  if (!SHA256.test(args.fileHash))
    return "--hash: a sha256 hash of 64 hex digits, as file read prints it";
  if (args.fileConfirm !== true)
    return "file write: needs --confirm, since it replaces a file of the checkout";
  return undefined;
}

/**
 * What is wrong with the `file` flags, or undefined: each flag belongs to its verbs, a search names its mode and
 * text, and a folder of another host is its own absolute path, in the style of either OS (this machine's current folder means nothing there).
 */
export function fileProblem(args: CliArgs): string | undefined {
  const onFile = args.command === "file";
  for (const [flag, typed, verbs] of flagged(args))
    if (typed && !(onFile && verbs.includes(args.action as string)))
      return `${flag}: this flag only applies to flightdeckd file ${verbs.join(", ")}`;
  if (!onFile) return undefined;
  if (args.action === "search") return searchProblem(args);
  if (args.action === "write") return writeProblem(args);
  if (args.host !== undefined && args.filePath !== undefined && args.action !== "read")
    return posix.isAbsolute(args.filePath) || win32.isAbsolute(args.filePath)
      ? undefined
      : `--host needs an absolute folder, the host's own path: ${args.filePath}`;
  return undefined;
}

/** What the file runner takes from the parsed arguments. */
export function fileCliArgs(args: CliArgs): FileCliArgs {
  const json = args.json ? { json: true as const } : {};
  const hidden = args.fileHidden ? { hidden: true as const } : {};
  const target = args.fileTarget ?? "";
  switch (args.action) {
    case "list":
      return { action: "list", target, dir: args.fileDir ?? "", ...json };
    case "read":
      return { action: "read", target, path: args.filePath ?? "", ...json };
    case "write":
      return {
        action: "write",
        target,
        path: args.filePath ?? "",
        file: args.fileText ?? "",
        expectedHash: args.fileHash ?? "",
        confirm: true,
        ...json,
      };
    case "search":
      return {
        action: "search",
        target,
        mode: args.fileMode ?? "name",
        query: args.fileQuery ?? "",
        ...(args.fileLimit === undefined ? {} : { limit: args.fileLimit }),
        ...json,
      };
    case "dirs":
      return {
        action: "dirs",
        ...(args.filePath === undefined ? {} : { path: args.filePath }),
        ...hidden,
        ...json,
      };
    default:
      return { action: "files", path: args.filePath ?? "", ...hidden, ...json };
  }
}
