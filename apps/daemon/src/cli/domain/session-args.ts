/**
 * Issue #3514: `flightdeckd session <verb>`, the verbs of one session. The parser in `args.ts` reads
 * the words after `session` here; the flags are checked there, with the usage text.
 */
import { EffortLevel } from "@flightdeck/protocol";
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
  args.sessionRef = operand(reader, "the session");
  if (action === "set-model") args.sessionValue = operand(reader, "the model");
  if (action === "set-effort") {
    const level = operand(reader, "the effort");
    if (level !== DEFAULT_WORD && !EffortLevel.safeParse(level).success)
      throw invalid("invalid effort", level);
    args.sessionValue = level;
  }
  if (action === "meta-set") args.sessionMeta = readFields(reader);
}
