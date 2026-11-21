/**
 * Issue #3615: `flightdeckd snippet <verb>`, the saved commands and prompts of a host. The parser in
 * `args.ts` reads the words after `snippet` here; the flags are checked here, with the usage text added
 * there. `list` and `get` are the mod's readers and keep their raw output and their flags; the other
 * verbs follow the CLI-first rules (`--json`, exit codes, `--host`).
 */
import type { SnippetVerbArgs } from "../../snippets/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const SNIPPET_ACTIONS = ["list", "get", "render", "parse", "import-history"] as const;
/** The verbs that follow the CLI-first rules: they take `--json` and `--host`. */
const NEW_VERBS = ["render", "parse", "import-history"];
/** `snippets.importHistory` takes at most this many candidates. */
const MOST_HISTORY = 200;

/** `snippet list`, `snippet get|render <name>`, `snippet parse <file or ->` or `snippet import-history`. */
export function readSnippet(args: CliArgs, reader: ArgReader): void {
  args.command = "snippet";
  const action = subAction(reader, SNIPPET_ACTIONS, "invalid snippet action");
  args.action = action;
  if (action === "get" || action === "render")
    args.snippetName = operand(reader, "the snippet name");
  if (action === "parse") args.snippetFile = operand(reader, "the file (or - for stdin)");
}

/** The flags only the snippet verbs take, for the parser's table of flags. */
export const SNIPPET_FLAGS: Record<string, Handler> = {
  "--value": setValue((args, v) => {
    const [name, ...rest] = v.split("=");
    if (!name || rest.length === 0) throw new Error(`--value needs name=value\n${USAGE}`);
    args.snippetValues = { ...args.snippetValues, [name]: rest.join("=") };
  }),
  "--reveal": setFlag((args) => {
    args.snippetReveal = true;
  }),
};

/** What is wrong with the snippet flags, or undefined: each flag belongs to its verbs. */
export function snippetProblem(args: CliArgs): string | undefined {
  const snippet = args.command === "snippet";
  const action = snippet ? (args.action as string) : "";
  const only = (flag: string, verbs: string) => `${flag}: this flag only applies to ${verbs}`;
  if (args.snippetValues !== undefined && action !== "render")
    return only("--value", "flightdeckd snippet render");
  if (args.snippetReveal !== undefined && action !== "import-history")
    return only("--reveal", "flightdeckd snippet import-history");
  if (!snippet) return undefined;
  if (args.projectPath !== undefined && !["list", "get", "render"].includes(action))
    return only("--project-path", "flightdeckd snippet list, get and render");
  const newVerbs = "flightdeckd snippet render, parse and import-history";
  if (args.host !== undefined && !NEW_VERBS.includes(action)) return only("--host", newVerbs);
  if (args.json && !NEW_VERBS.includes(action)) return only("--json", newVerbs);
  if (args.limit !== undefined) {
    if (action !== "import-history") return only("--limit", "flightdeckd snippet import-history");
    if (args.limit > MOST_HISTORY) return `--limit: at most ${MOST_HISTORY}`;
  }
  return undefined;
}

/** What the snippet runner takes from the parsed arguments: each field only when the person gave it. */
export function snippetCliArgs(args: CliArgs): SnippetVerbArgs {
  return {
    action: args.action as SnippetVerbArgs["action"],
    ...(args.snippetName === undefined ? {} : { name: args.snippetName }),
    ...(args.projectPath === undefined ? {} : { projectPath: args.projectPath }),
    ...(args.snippetValues === undefined ? {} : { values: args.snippetValues }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.snippetReveal ? { reveal: true } : {}),
    ...(args.json ? { json: true } : {}),
  };
}
