/**
 * Issue #3538: `flightdeckd terminal <verb>`, the terminals a host keeps. The parser in `args.ts` reads
 * the words after `terminal` here and this file checks the flags, with the usage text added there. The
 * verbs that stream a terminal's output or type into it (`attach`, `write`, `resize`, `ack`, `detach`)
 * belong to the app's view and are not words of this noun.
 */
import type { TerminalCliArgs } from "../../terminal/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag, setValue } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const TERMINAL_ACTIONS = ["list", "open", "open-session", "close", "settings"] as const;
const DEFAULT_SIZE = { cols: 80, rows: 24 };
/** What the protocol takes for a terminal's size (`terminal.open`). */
const LIMITS = { cols: 500, rows: 300 };

/** `terminal list|open|open-session|settings`, or `terminal close <terminal>`. */
export function readTerminal(args: CliArgs, reader: ArgReader): void {
  args.command = "terminal";
  const action = subAction(reader, TERMINAL_ACTIONS, "invalid terminal action");
  args.action = action;
  if (action === "close") args.terminalId = operand(reader, "the terminal id");
}

const size =
  (flag: "--cols" | "--rows", field: "terminalCols" | "terminalRows"): Handler =>
  (args, _reader, value) => {
    const given = value();
    const max = LIMITS[flag === "--cols" ? "cols" : "rows"];
    if (!/^\d+$/.test(given) || Number(given) < 1 || Number(given) > max)
      throw new Error(`${flag}: a whole number from 1 to ${max}\n${USAGE}`);
    args[field] = Number(given);
  };

/** The flags of the terminal verbs; each verb takes its own, checked in `terminalProblem`. */
export const TERMINAL_FLAGS: Record<string, Handler> = {
  "--": (args, reader) => {
    args.terminalArgv = reader.takeRest();
  },
  "--cols": size("--cols", "terminalCols"),
  "--rows": size("--rows", "terminalRows"),
  "--resume": setValue((args, v) => {
    args.terminalResume = v;
  }),
  "--claude": setFlag((args) => {
    args.terminalClaude = true;
  }),
  "--kill": setFlag((args) => {
    args.terminalKill = true;
  }),
  "--enable": setFlag((args) => {
    args.terminalEnable = true;
  }),
  "--disable": setFlag((args) => {
    args.terminalDisable = true;
  }),
};

/**
 * `--cwd`, `--session`, `--persona` and `--confirm` are other commands' flags too: on `terminal` they
 * move into fields of its own, so no other command's check reads them.
 */
export function takeTerminalFlags(args: CliArgs): void {
  if (args.command !== "terminal") return;
  const moved = {
    terminalCwd: args.cwd,
    terminalSession: args.session,
    terminalPersona: args.teamPersona,
    terminalConfirm: args.confirm,
  };
  for (const [field, value] of Object.entries(moved))
    if (value !== undefined) Object.assign(args, { [field]: value });
  delete args.cwd;
  delete args.session;
  delete args.teamPersona;
  delete args.confirm;
}

const OPENS = ["open"];

/** Every flag of the terminal verbs, whether it was typed, and the verbs that take it. */
const flagged = (args: CliArgs): Array<[string, boolean, readonly string[]]> => [
  ["--cwd", args.terminalCwd !== undefined, OPENS],
  ["--", args.terminalArgv !== undefined, OPENS],
  ["--claude", args.terminalClaude === true, OPENS],
  ["--session", args.terminalSession !== undefined, ["open-session"]],
  ["--cols", args.terminalCols !== undefined, ["open", "open-session"]],
  ["--rows", args.terminalRows !== undefined, ["open", "open-session"]],
  ["--kill", args.terminalKill === true, ["close"]],
  ["--enable", args.terminalEnable === true, ["settings"]],
  ["--disable", args.terminalDisable === true, ["settings"]],
  ["--resume", args.terminalResume !== undefined, OPENS],
  ["--persona", args.terminalPersona !== undefined, OPENS],
];

/** What is wrong with the terminal words and flags, or undefined. */
export function terminalProblem(args: CliArgs): string | undefined {
  const terminal = args.command === "terminal";
  for (const [flag, typed, verbs] of flagged(args)) {
    if (!typed) continue;
    if (!terminal || !verbs.includes(args.action ?? ""))
      return `${flag}: this flag only applies to flightdeckd terminal ${verbs.join(", ")}`;
  }
  if (!terminal) return undefined;
  if (args.action === "open") {
    if (args.terminalCwd === undefined) return "missing --cwd";
    if (args.terminalClaude && args.terminalArgv !== undefined)
      return "--claude and a program after -- cannot go together";
    if (args.terminalArgv?.length === 0) return "--: give the program to run after it";
    if (!args.terminalClaude && args.terminalResume !== undefined)
      return "--resume: only with --claude";
    if (!args.terminalClaude && args.terminalPersona !== undefined)
      return "--persona: only with --claude";
  }
  if (args.action === "open-session" && args.terminalSession === undefined)
    return "missing --session";
  if (args.action === "settings") {
    if (args.terminalEnable && args.terminalDisable) return "--enable or --disable, not both";
    if (!args.terminalEnable && !args.terminalDisable)
      return "terminal settings needs --enable or --disable";
  }
  if (args.terminalConfirm && !(args.action === "settings" && args.terminalEnable))
    return "--confirm: only with terminal settings --enable";
  return undefined;
}

/** What the terminal runner takes from the parsed arguments. */
export function terminalCliArgs(args: CliArgs): TerminalCliArgs {
  const json = args.json ? { json: true as const } : {};
  const size = {
    cols: args.terminalCols ?? DEFAULT_SIZE.cols,
    rows: args.terminalRows ?? DEFAULT_SIZE.rows,
  };
  switch (args.action) {
    case "open":
      return {
        action: "open",
        cwd: args.terminalCwd as string,
        ...size,
        ...(args.terminalArgv ? { command: args.terminalArgv } : {}),
        ...(args.terminalClaude
          ? {
              claude: {
                ...(args.terminalResume === undefined ? {} : { resume: args.terminalResume }),
                ...(args.terminalPersona === undefined ? {} : { persona: args.terminalPersona }),
              },
            }
          : {}),
        ...json,
      };
    case "open-session":
      return { action: "open-session", session: args.terminalSession as string, ...size, ...json };
    case "close":
      return {
        action: "close",
        terminalId: args.terminalId as string,
        kill: args.terminalKill === true,
        ...json,
      };
    case "settings":
      return {
        action: "settings",
        enabled: args.terminalEnable === true,
        ...(args.terminalConfirm ? { confirm: true } : {}),
        ...json,
      };
    default:
      return { action: "list", ...json };
  }
}
