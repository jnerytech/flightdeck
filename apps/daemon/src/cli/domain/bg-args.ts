/**
 * Issue #3734: `flightdeckd bg list|start|stop|respawn|message`, the background sessions (`claude --bg`) of a host
 * from a shell. The parser in `args.ts` reads the words after the noun here. `--cwd`, `--prompt`, `--name`,
 * `--persona` and `--text` are flags other commands read too, so `takeBgFlags` moves them out of the shared fields
 * once the line is read (as `takeSessionFlags` does), and `bgProblem` checks them against the verb. `--json` and
 * `--host` are checked in `args.ts` with the other commands'.
 */
import { posix, win32 } from "node:path";
import type { BgCliArgs } from "../../bg/index.ts";
import { type ArgReader, invalid, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setValue } from "./flag-handlers.ts";

/** The id of a background session, as the protocol accepts it (`BgId` in `packages/protocol/src/sessions.ts`). */
const BG_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A persona id, as `bg.start` accepts it. */
const PERSONA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TEXT = 32_000;
const MAX_NAME = 120;

/** `bg list`, `bg start`, `bg stop|respawn <id>` or `bg message <id>`. */
export function readBg(args: CliArgs, reader: ArgReader): void {
  args.command = "bg";
  args.action = subAction(
    reader,
    ["list", "start", "stop", "respawn", "message"] as const,
    "invalid bg action",
  );
  if (args.action === "stop" || args.action === "respawn" || args.action === "message") {
    const id = operand(reader, "the background session id");
    if (!BG_ID.test(id)) throw invalid("invalid background session id", id);
    args.bgId = id;
  }
}

/** `--card`, the flag only `bg start` takes, for the parser's table of flags. */
export const BG_FLAGS: Record<string, Handler> = {
  "--card": setValue((args, v) => {
    args.bgFlags = { ...args.bgFlags, card: v };
  }),
};

/** The shared flags `bg` reads, the field each one set and the flag's name in `bgFlags`. */
const SHARED = [
  ["cwd", "cwd"],
  ["name", "personaName"],
  ["persona", "teamPersona"],
  ["text", "snippetText"],
] as const;

/** `bg ...`: moves the shared flags into `bgFlags`, so no other command's check sees them. */
export function takeBgFlags(args: CliArgs): void {
  if (args.command !== "bg") return;
  const flags = { ...args.bgFlags };
  for (const [option, field] of SHARED) {
    if (args[field] === undefined) continue;
    flags[option] = args[field];
    delete args[field];
  }
  const { prompt, ...rest } = args.sessionStart ?? {};
  if (prompt !== undefined) {
    flags.prompt = prompt;
    if (Object.keys(rest).length === 0) delete args.sessionStart;
    else args.sessionStart = rest;
  }
  if (Object.keys(flags).length > 0) args.bgFlags = flags;
}

/** The flags each verb takes. */
const VERB_FLAGS: Record<string, readonly string[]> = {
  start: ["cwd", "prompt", "card", "name", "persona"],
  message: ["text"],
};

function lengthProblem(flag: string, value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (value === "") return `${flag}: empty`;
  return value.length > max ? `${flag}: more than ${max} characters` : undefined;
}

/** What is wrong with the flags of `bg`, or of another command that was given `--card`. */
export function bgProblem(args: CliArgs): string | undefined {
  const flags = args.bgFlags ?? {};
  if (args.command !== "bg") {
    return flags.card === undefined
      ? undefined
      : "--card: this flag only applies to flightdeckd bg start";
  }
  const verb = args.action as string;
  const allowed = VERB_FLAGS[verb] ?? [];
  for (const flag of Object.keys(flags))
    if (!allowed.includes(flag))
      return `--${flag}: this flag only applies to flightdeckd bg ${Object.entries(VERB_FLAGS)
        .filter(([, flagsOf]) => flagsOf.includes(flag))
        .map(([name]) => name)
        .join(", ")}`;
  if (verb === "message") {
    if (flags.text === undefined) return "bg message needs --text";
    return lengthProblem("--text", flags.text, MAX_TEXT);
  }
  if (verb !== "start") return undefined;
  const hasPair = flags.cwd !== undefined && flags.prompt !== undefined;
  if (flags.card === undefined && !hasPair) return "bg start needs --cwd and --prompt, or --card";
  if (flags.card !== undefined && (flags.cwd !== undefined || flags.prompt !== undefined))
    return "bg start takes --card, or --cwd and --prompt, not both";
  if (flags.cwd !== undefined && !posix.isAbsolute(flags.cwd) && !win32.isAbsolute(flags.cwd))
    return "--cwd: must be an absolute path (the daemon resolves a relative one against its own folder)";
  if (flags.persona !== undefined && !PERSONA_ID.test(flags.persona))
    return `--persona: ${flags.persona} is not a persona id`;
  return (
    lengthProblem("--prompt", flags.prompt, MAX_TEXT) ??
    lengthProblem("--name", flags.name, MAX_NAME) ??
    lengthProblem("--cwd", flags.cwd, Number.MAX_SAFE_INTEGER) ??
    lengthProblem("--card", flags.card, Number.MAX_SAFE_INTEGER)
  );
}

/** What the background sessions runner takes from the parsed arguments. */
export function bgCliArgs(args: CliArgs): BgCliArgs {
  const json = args.json ? { json: true as const } : {};
  const flags = args.bgFlags ?? {};
  const id = args.bgId ?? "";
  if (args.action === "start") {
    const { cwd, prompt, card, name, persona } = flags;
    return {
      action: "start",
      ...(cwd === undefined ? {} : { cwd }),
      ...(prompt === undefined ? {} : { prompt }),
      ...(card === undefined ? {} : { card }),
      ...(name === undefined ? {} : { name }),
      ...(persona === undefined ? {} : { persona }),
      ...json,
    };
  }
  if (args.action === "stop" || args.action === "respawn")
    return { action: args.action, id, ...json };
  if (args.action === "message") return { action: "message", id, text: flags.text ?? "", ...json };
  return { action: "list", ...json };
}
