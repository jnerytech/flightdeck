/**
 * Issue #3539: `flightdeckd watch <verb>`, a card's PR watch from a shell. The parser in `args.ts` reads
 * the words after `watch` here and this file checks the flags, with the usage text added there; `--json`
 * and `--host` are checked there with the other commands'. `--check`, `--clear-checks`, `--persona`,
 * `--rounds`, `--enable` and `--disable` are other commands' flags too: on `watch` they move into fields
 * of its own, so no other command's check reads them.
 */
import { WatchSettings } from "@flightdeck/protocol";
import type { WatchCliArgs } from "../../watch/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

const WATCH_ACTIONS = [
  "get",
  "trace",
  "describe",
  "by-url",
  "settings",
  "set",
  "extend",
  "resolve-held",
  "follow",
] as const;

/** What the operand of each verb is called in a refusal. */
const OPERANDS = {
  get: "the card",
  trace: "the card",
  describe: "the card",
  "by-url": "the PR link",
  settings: "the project",
  set: "the card",
  extend: "the card",
  "resolve-held": "the card",
  follow: "",
} as const;

/** `watch follow`, `watch get|trace|describe|set|extend <card>`, `watch resolve-held <card> <round>`, `watch by-url <link>` or `watch settings <project>`. */
export function readWatch(args: CliArgs, reader: ArgReader): void {
  args.command = "watch";
  const verb = subAction(reader, WATCH_ACTIONS, "invalid watch action");
  args.action = verb;
  // `follow` takes no operand: the stream carries every card's watch.
  args.watchTarget = verb === "follow" ? "" : operand(reader, OPERANDS[verb]);
  if (verb === "resolve-held") args.watchRound = operand(reader, "the round");
}

/** A flag of the watch verbs: it remembers it was typed, so a verb that does not take it can say so. */
const typed =
  (flag: string, set: (args: CliArgs, value: string) => void): Handler =>
  (args, _reader, value) => {
    args.watchFlags = [...(args.watchFlags ?? []), flag];
    set(args, value());
  };

const typedFlag = (flag: string, set: (args: CliArgs) => void): Handler =>
  setFlag((args) => {
    args.watchFlags = [...(args.watchFlags ?? []), flag];
    set(args);
  });

const patchOf = (args: CliArgs): Record<string, unknown> => {
  args.watchPatch ??= {};
  return args.watchPatch;
};

/** A field a flag sets once. */
function setField(args: CliArgs, flag: string, field: string, value: unknown): void {
  const patch = patchOf(args);
  if (Object.hasOwn(patch, field)) throw new Error(`${flag}: once\n${USAGE}`);
  patch[field] = value;
}

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;

/** A whole number; the protocol's own limit is checked with the rest of the patch. */
const whole = (flag: string, field: string): Handler =>
  typed(flag, (a, v) => {
    if (!WHOLE.test(v)) throw new Error(`${flag}: a whole number\n${USAGE}`);
    setField(a, flag, field, Number(v));
  });

/** A whole number or a decimal, or `none` for no limit. */
const orNone = (flag: string, field: string, shape: RegExp, what: string): Handler =>
  typed(flag, (a, v) => {
    if (v !== "none" && !shape.test(v)) throw new Error(`${flag}: ${what}, or none\n${USAGE}`);
    setField(a, flag, field, v === "none" ? null : Number(v));
  });

/** A name or a glob; the flag repeats, and its `--clear-*` twin empties the list. */
const listed = (flag: string, field: string): Handler =>
  typed(flag, (a, v) => {
    const patch = patchOf(a);
    if (a.watchFlags?.includes(`--clear-${flag.slice(2)}`))
      throw new Error(`${flag}: not with the flag that clears it\n${USAGE}`);
    patch[field] = [...((patch[field] as string[] | undefined) ?? []), v];
  });

const cleared = (flag: string, field: string): Handler =>
  typedFlag(flag, (args) => {
    const patch = patchOf(args);
    if (Object.hasOwn(patch, field))
      throw new Error(`${flag}: not with the flag that adds to it\n${USAGE}`);
    patch[field] = [];
  });

const switching = (flag: string, to: boolean | null): Handler =>
  typedFlag(flag, (args) => {
    if (args.watchSwitch !== undefined)
      throw new Error(`--enable, --disable or --default, not more than one\n${USAGE}`);
    args.watchSwitch = to;
  });

/** The flags of the watch verbs; each verb takes its own, checked in `watchProblem`. */
export const WATCH_FLAGS: Record<string, Handler> = {
  "--default": switching("--default", null),
  "--push": typedFlag("--push", (args) => {
    if (args.watchResolution !== undefined) throw new Error(`--push or --drop, not both\n${USAGE}`);
    args.watchResolution = "push";
  }),
  "--drop": typedFlag("--drop", (args) => {
    if (args.watchResolution !== undefined) throw new Error(`--push or --drop, not both\n${USAGE}`);
    args.watchResolution = "drop";
  }),
  "--max-rounds": whole("--max-rounds", "maxRounds"),
  "--check-timeout-min": whole("--check-timeout-min", "checkTimeoutMin"),
  "--max-failures": whole("--max-failures", "maxFailures"),
  "--check-rounds": whole("--check-rounds", "checkRounds"),
  "--budget-usd": orNone("--budget-usd", "budgetUsd", DECIMAL, "an amount in US$"),
  "--daily-usd": orNone("--daily-usd", "dailyUsd", DECIMAL, "an amount in US$"),
  "--max-turns": orNone("--max-turns", "maxTurns", WHOLE, "a whole number"),
  "--check-env": listed("--check-env", "checkEnv"),
  "--clear-check-env": cleared("--clear-check-env", "checkEnv"),
  "--drift-allow": listed("--drift-allow", "driftAllow"),
  "--clear-drift-allow": cleared("--clear-drift-allow", "driftAllow"),
  "--check-loop-default": typed("--check-loop-default", (args, v) => {
    if (v !== "on" && v !== "off") throw new Error(`--check-loop-default: on or off\n${USAGE}`);
    setField(args, "--check-loop-default", "checkLoopDefault", v === "on");
  }),
};

/** The verbs that take each flag. */
const TAKEN_BY: Record<string, readonly string[]> = {
  "--default": ["set"],
  "--enable": ["set", "settings"],
  "--disable": ["set", "settings"],
  "--push": ["resolve-held"],
  "--drop": ["resolve-held"],
  "--rounds": ["extend"],
};
const SETTINGS_ONLY = [
  "--max-rounds",
  "--check-timeout-min",
  "--max-failures",
  "--check-rounds",
  "--budget-usd",
  "--daily-usd",
  "--max-turns",
  "--check-env",
  "--clear-check-env",
  "--drift-allow",
  "--clear-drift-allow",
  "--check-loop-default",
  "--check",
  "--clear-checks",
  "--persona",
];
for (const flag of SETTINGS_ONLY) TAKEN_BY[flag] = ["settings"];

/**
 * On `watch`, the flags other commands share move into the fields of this one, and the originals go, so
 * no other command's check refuses them.
 */
export function takeWatchFlags(args: CliArgs): void {
  if (args.command !== "watch") return;
  const flags = args.watchFlags ?? [];
  const patch = args.watchPatch ?? {};
  if (args.teamChecks !== undefined) {
    flags.push("--check");
    patch.checks = args.teamChecks;
  }
  if (args.teamClearChecks) {
    flags.push("--clear-checks");
    if (patch.checks !== undefined) throw new Error(`--clear-checks: not with --check\n${USAGE}`);
    patch.checks = [];
  }
  if (args.teamPersona !== undefined) {
    flags.push("--persona");
    patch.persona = args.teamPersona;
  }
  if (args.rounds !== undefined) {
    flags.push("--rounds");
    args.watchRounds = args.rounds;
  }
  if (args.terminalEnable || args.terminalDisable) {
    if (args.terminalEnable && args.terminalDisable)
      throw new Error(`--enable, --disable or --default, not more than one\n${USAGE}`);
    if (args.watchSwitch !== undefined)
      throw new Error(`--enable, --disable or --default, not more than one\n${USAGE}`);
    flags.push(args.terminalEnable ? "--enable" : "--disable");
    args.watchSwitch = args.terminalEnable === true;
  }
  if (flags.length > 0) args.watchFlags = flags;
  if (Object.keys(patch).length > 0) args.watchPatch = patch;
  delete args.teamChecks;
  delete args.teamClearChecks;
  delete args.teamPersona;
  delete args.rounds;
  delete args.terminalEnable;
  delete args.terminalDisable;
}

/** The flag that sets a field of the patch, for a refusal that names it. */
const FLAG_NAMES = new Map([
  ["checks", "--check"],
  ["enabled", "--enable"],
]);

const flagOf = (field: string): string => {
  const kebab = field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return FLAG_NAMES.get(field) ?? `--${kebab}`;
};

/** What is wrong with the watch words and flags, or undefined. */
export function watchProblem(args: CliArgs): string | undefined {
  const flags = args.watchFlags ?? [];
  for (const flag of flags) {
    const verbs = TAKEN_BY[flag] ?? [];
    if (args.command !== "watch" || !verbs.includes(args.action ?? ""))
      return `${flag}: this flag only applies to flightdeckd watch ${verbs.join(", ")}`;
  }
  if (args.command !== "watch") return undefined;
  const asked = (flag: string) => flags.includes(flag);
  if (args.action === "set" && args.watchSwitch === undefined)
    return "watch set needs --enable, --disable or --default";
  if (args.action === "extend" && args.watchRounds === undefined) return "missing --rounds";
  if (args.action === "resolve-held" && args.watchResolution === undefined)
    return "watch resolve-held needs --push or --drop";
  if (args.action !== "settings") return undefined;
  const patch = {
    ...args.watchPatch,
    ...(args.watchSwitch === undefined ? {} : { enabled: args.watchSwitch }),
  };
  if (asked("--check") && asked("--clear-checks")) return "--clear-checks: not with --check";
  const checked = WatchSettings.partial().strict().safeParse(patch);
  if (checked.success) return undefined;
  const issue = checked.error.issues[0];
  return `${flagOf(String(issue?.path[0]))}: ${issue?.message}`;
}

/** What the watch runner takes from the parsed arguments. */
export function watchCliArgs(args: CliArgs): WatchCliArgs {
  const json = args.json ? { json: true as const } : {};
  const target = args.watchTarget ?? "";
  switch (args.action) {
    case "follow":
      return { action: "follow", target, ...json };
    case "set":
      return { action: "set", target, enabled: args.watchSwitch as boolean | null, ...json };
    case "extend":
      return { action: "extend", target, rounds: args.watchRounds as number, ...json };
    case "resolve-held":
      return {
        action: "resolve-held",
        target,
        round: args.watchRound as string,
        resolution: args.watchResolution as "push" | "drop",
        ...json,
      };
    case "settings": {
      const patch = {
        ...args.watchPatch,
        ...(args.watchSwitch === undefined ? {} : { enabled: args.watchSwitch as boolean }),
      };
      return {
        action: "settings",
        target,
        ...(Object.keys(patch).length > 0 ? { patch } : {}),
        ...json,
      };
    }
    default:
      return { action: args.action as "get" | "trace" | "describe" | "by-url", target, ...json };
  }
}
