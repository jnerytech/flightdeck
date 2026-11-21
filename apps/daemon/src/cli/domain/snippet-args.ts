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

const SNIPPET_ACTIONS = [
  "list",
  "get",
  "render",
  "parse",
  "import-history",
  "save",
  "remove",
  "favorite",
  "trust",
  "use",
] as const;
/** The verbs that follow the CLI-first rules: they take `--json` and `--host`. `list` and `get` are the mod's readers. */
const NEW_VERBS: string[] = SNIPPET_ACTIONS.filter((verb) => verb !== "list" && verb !== "get");
/** The verbs that change what the host keeps or runs: each needs `--confirm`. */
const WRITES = ["save", "remove", "trust", "use"];
/** The verbs that take the snippet's name. */
const NAMED = ["get", "render", "save", "remove", "favorite", "use"];
/** `snippets.importHistory` takes at most this many candidates. */
const MOST_HISTORY = 200;

/**
 * `snippet list`, `snippet get|render|save|remove|favorite|use <name>`, `snippet parse <file or ->`,
 * `snippet trust` or `snippet import-history`.
 */
export function readSnippet(args: CliArgs, reader: ArgReader): void {
  args.command = "snippet";
  const action = subAction(reader, SNIPPET_ACTIONS, "invalid snippet action");
  args.action = action;
  if (NAMED.includes(action)) args.snippetName = operand(reader, "the snippet name");
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
  "--run": setValue((args, v) => {
    args.snippetRun = v;
  }),
  "--text": setValue((args, v) => {
    args.snippetText = v;
  }),
  "--select": setValue((args, v) => {
    args.snippetSelect = v.split(",").filter(Boolean);
  }),
  "--terminal": setValue((args, v) => {
    args.snippetTerminal = v;
  }),
  "--enter": setFlag((args) => {
    args.snippetEnter = true;
  }),
  "--off": setFlag((args) => {
    args.snippetOff = true;
  }),
};

/** The flags another command takes too. */
const SHARED = ["--hash", "--tag", "--project-path"];

/** Each flag of the snippet verbs, with the verbs it belongs to. */
const FLAG_VERBS: Array<[flag: string, given: (args: CliArgs) => boolean, verbs: string[]]> = [
  ["--value", (a) => a.snippetValues !== undefined, ["render", "use"]],
  ["--reveal", (a) => a.snippetReveal !== undefined, ["import-history"]],
  ["--run", (a) => a.snippetRun !== undefined, ["save"]],
  ["--text", (a) => a.snippetText !== undefined, ["save"]],
  ["--select", (a) => a.snippetSelect !== undefined, ["import-history"]],
  ["--terminal", (a) => a.snippetTerminal !== undefined, ["use"]],
  ["--enter", (a) => a.snippetEnter !== undefined, ["use"]],
  ["--off", (a) => a.snippetOff !== undefined, ["favorite"]],
  ["--hash", (a) => a.hash !== undefined, ["trust"]],
  ["--tag", (a) => a.tags !== undefined, ["save"]],
  [
    "--project-path",
    (a) => a.projectPath !== undefined,
    ["list", "get", "render", "save", "remove", "favorite", "trust", "use"],
  ],
];

/** What is wrong with the snippet flags, or undefined: each flag belongs to its verbs, and a verb that writes needs --confirm. */
export function snippetProblem(args: CliArgs): string | undefined {
  const snippet = args.command === "snippet";
  const action = snippet ? (args.action as string) : "";
  const only = (flag: string, verbs: string) => `${flag}: this flag only applies to ${verbs}`;
  for (const [flag, given, verbs] of FLAG_VERBS) {
    if (!given(args) || verbs.includes(action)) continue;
    // `--hash`, `--tag` and `--project-path` are also another command's, which checks them.
    if (snippet || !SHARED.includes(flag))
      return only(flag, `flightdeckd snippet ${verbs.join(", ")}`);
  }
  if (!snippet) return undefined;
  const confirmed = args.confirm !== undefined;
  const writes =
    WRITES.includes(action) || (action === "import-history" && args.snippetSelect !== undefined);
  if (confirmed && !writes)
    return only(
      "--confirm",
      "flightdeckd snippet save, remove, trust, use and import-history --select",
    );
  if (writes && !confirmed)
    return `snippet ${action}${action === "import-history" ? " --select" : ""} needs --confirm`;
  if (args.host !== undefined && !NEW_VERBS.includes(action))
    return only("--host", `flightdeckd snippet ${NEW_VERBS.join(", ")}`);
  if (args.json && !NEW_VERBS.includes(action))
    return only("--json", `flightdeckd snippet ${NEW_VERBS.join(", ")}`);
  if (args.limit !== undefined) {
    if (action !== "import-history") return only("--limit", "flightdeckd snippet import-history");
    if (args.limit > MOST_HISTORY) return `--limit: at most ${MOST_HISTORY}`;
  }
  if ((args.snippetSelect?.length ?? 0) > MOST_HISTORY) return `--select: at most ${MOST_HISTORY}`;
  return missingOperand(args, action);
}

/** `save`, `trust` and `use` need more than a name: what is missing says so. */
function missingOperand(args: CliArgs, action: string): string | undefined {
  if (action === "save" && (args.snippetRun === undefined) === (args.snippetText === undefined))
    return "snippet save needs exactly one of --run and --text";
  if (action === "trust" && args.hash === undefined) return "snippet trust needs --hash";
  if (action === "trust" && args.projectPath === undefined)
    return "snippet trust needs --project-path";
  if (action === "use" && args.snippetTerminal === undefined) return "snippet use needs --terminal";
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
    ...(args.snippetRun === undefined ? {} : { run: args.snippetRun }),
    ...(args.snippetText === undefined ? {} : { prompt: args.snippetText }),
    ...(args.tags === undefined ? {} : { tags: args.tags }),
    ...(args.hash === undefined ? {} : { hash: args.hash }),
    ...(args.snippetSelect === undefined ? {} : { select: args.snippetSelect }),
    ...(args.snippetTerminal === undefined ? {} : { terminalId: args.snippetTerminal }),
    ...(args.snippetEnter ? { enter: true } : {}),
    ...(args.snippetOff ? { off: true } : {}),
    ...(args.json ? { json: true } : {}),
  };
}
