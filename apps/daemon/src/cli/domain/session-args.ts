/**
 * Issue #3514: `flightdeckd session <verb>`, the verbs of one session. The parser in `args.ts` reads
 * the words after `session` here; the flags are checked there, with the usage text.
 */
import { EffortLevel, SettableMode } from "@flightdeck/protocol";
import type { SessionStartOptions } from "../../sessions/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { USAGE } from "./usage.ts";

const SESSION_ACTIONS = [
  "interrupted",
  "summary",
  "files",
  "interrupt",
  "close",
  "resume",
  "sleep",
  "set-model",
  "set-effort",
  "meta",
  "create",
  "set-mode",
  "fork",
  "apply-persona",
  "clear-persona",
] as const;

/** The levels of `set-effort` are the protocol's own; `default` gives the model's own back. */
const DEFAULT_WORD = "default";

/** `name=<text>`, `pinned=<true|false>` or `archived=<true|false>`: a field of `meta set`, a text without `=` is refused. */
function readField(word: string, meta: NonNullable<CliArgs["sessionMeta"]>): void {
  const at = word.indexOf("=");
  const key = at < 0 ? word : word.slice(0, at);
  const value = at < 0 ? "" : word.slice(at + 1);
  if (at < 0 || !["name", "pinned", "archived"].includes(key)) {
    throw invalid("invalid session field", key);
  }
  if (key === "name") {
    meta.name = value === "" ? null : value;
    return;
  }
  if (value !== "true" && value !== "false") {
    throw new Error(`${key} must be true or false\n${USAGE}`);
  }
  meta[key as "pinned" | "archived"] = value === "true";
}

/** The fields of `meta set <session>`, up to the next flag; at least one. */
function readFields(reader: ArgReader): NonNullable<CliArgs["sessionMeta"]> {
  const meta: NonNullable<CliArgs["sessionMeta"]> = {};
  for (
    let word = reader.peek();
    word !== undefined && !word.startsWith("--");
    word = reader.peek()
  ) {
    readField(reader.next() ?? "", meta);
  }
  if (Object.keys(meta).length === 0) throw new Error(`missing a field to set\n${USAGE}`);
  return meta;
}

/** The shared flags of `session create`, set apart from the other commands' fields once the line is read. */
const MOVED_FLAGS = [
  ["cwd", "cwd"],
  ["name", "personaName"],
  ["model", "model"],
  ["effort", "effort"],
  ["permissionMode", "permissionMode"],
  ["persona", "teamPersona"],
  ["language", "language"],
] as const satisfies ReadonlyArray<readonly [keyof SessionStartOptions, keyof CliArgs]>;

/** Every flag of `session create|fork|apply-persona|clear-persona`, the option it sets and the verbs that take it. */
const START_FLAGS: ReadonlyArray<readonly [string, keyof SessionStartOptions, readonly string[]]> =
  [
    ["--cwd", "cwd", ["create", "fork"]],
    ["--prompt", "prompt", ["create"]],
    ["--name", "name", ["create"]],
    ["--model", "model", ["create"]],
    ["--effort", "effort", ["create"]],
    ["--permission-mode", "permissionMode", ["create"]],
    ["--persona", "persona", ["create"]],
    ["--language", "language", ["create", "apply-persona", "clear-persona"]],
    ["--up-to", "upToMessageId", ["fork"]],
    ["--open", "open", ["fork"]],
  ];

/** `session ...`: the flags that other commands also read (`--cwd`, `--model`, ...) move into `sessionStart`, so no other check sees them. */
export function takeSessionFlags(args: CliArgs): void {
  if (args.command !== "session") return;
  const start: SessionStartOptions = args.sessionStart ?? {};
  for (const [option, field] of MOVED_FLAGS) {
    const value = args[field];
    if (value === undefined) continue;
    Object.assign(start, { [option]: value });
    delete args[field];
  }
  if (Object.keys(start).length > 0) args.sessionStart = start;
}

/** What is wrong with the flags of `session`, or of another command that was given one of them. */
export function sessionProblem(args: CliArgs): string | undefined {
  for (const [flag, option, verbs] of START_FLAGS) {
    if (args.sessionStart?.[option] === undefined) continue;
    if (args.command !== "session" || !verbs.includes(args.action as string))
      return `${flag}: this flag only applies to flightdeckd session ${verbs.join(", ")}`;
  }
  const start = args.sessionStart;
  if (args.command !== "session" || (args.action !== "create" && args.action !== "fork"))
    return undefined;
  if (start?.cwd === undefined || start.cwd === "") return "missing --cwd";
  if (args.action === "create" && start.language !== undefined && start.persona === undefined)
    return "--language: only with --persona";
  return undefined;
}

/**
 * `session interrupted`, or `session <verb> <session>` (the session is its name or its id), with the
 * model, the effort or the fields the verb sets after it.
 */
export function readSession(args: CliArgs, reader: ArgReader): void {
  args.command = "session";
  const verb = subAction(reader, SESSION_ACTIONS, "invalid session action");
  const action = verb === "meta" ? "meta-set" : verb;
  if (verb === "meta") subAction(reader, ["set"] as const, "invalid session meta action");
  args.action = action;
  if (action === "interrupted") return;
  if (action === "create") return;
  if (action === "fork") {
    args.claudeSessionId = operand(reader, "the Claude session id");
    return;
  }
  args.sessionRef = operand(reader, "the session");
  if (action === "set-mode") {
    const mode = operand(reader, "the mode");
    if (!SettableMode.safeParse(mode).success) throw invalid("invalid mode", mode);
    args.sessionValue = mode;
  }
  if (action === "apply-persona") args.sessionValue = operand(reader, "the persona");
  if (action === "set-model") args.sessionValue = operand(reader, "the model");
  if (action === "set-effort") {
    const level = operand(reader, "the effort");
    if (level !== DEFAULT_WORD && !EffortLevel.safeParse(level).success)
      throw invalid("invalid effort", level);
    args.sessionValue = level;
  }
  if (action === "meta-set") args.sessionMeta = readFields(reader);
}
