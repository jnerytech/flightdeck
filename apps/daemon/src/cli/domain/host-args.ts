/**
 * Issue #3699: what `flightdeckd host <verb>` and `flightdeckd resources <verb>` take, checked before anything is
 * sent. A bare `host` or `resources` still reads (`host.info`, `resources.get`); a verb changes one setting of the
 * host. The parser in `args.ts` adds the usage text to the problem this names.
 */
import type { HostCliArgs } from "../../hosts/index.ts";
import { operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { parseShare } from "./quota-args.ts";
import { USAGE } from "./usage.ts";

const HOST_VERBS = ["sleep", "keep-awake", "pause", "updates", "bypass"] as const;
const RESOURCES_VERBS = ["pause-at", "end-orphan"] as const;

/** A verb follows only when the next word is no flag: `host --json` is still the read. */
const verbFollows = (peek: string | undefined): boolean =>
  peek !== undefined && !peek.startsWith("-");

/** A whole number as plain digits (no sign, exponent, hex or space) within `[min, max]`, or undefined. */
function wholeNumber(text: string, min: number, max: number): number | undefined {
  if (!/^\d{1,15}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

export const hostHandler: Handler = (args, reader) => {
  args.command = "host";
  if (!verbFollows(reader.peek())) return;
  const action = subAction(reader, HOST_VERBS, "invalid host action");
  args.action = action;
  if (action === "sleep") {
    const minutes = wholeNumber(operand(reader, "the minutes"), 0, 1440);
    if (minutes === undefined)
      throw new Error(`host sleep: whole minutes from 0 to 1440 (0 is off)\n${USAGE}`);
    args.hostMinutes = minutes;
    return;
  }
  const word = operand(reader, "on or off");
  if (word !== "on" && word !== "off") throw new Error(`host ${action}: on or off\n${USAGE}`);
  args.hostSwitch = word;
};

export const resourcesHandler: Handler = (args, reader) => {
  args.command = "resources";
  if (!verbFollows(reader.peek())) return;
  const action = subAction(reader, RESOURCES_VERBS, "invalid resources action");
  args.action = action;
  if (action === "pause-at") {
    const share = parseShare(operand(reader, "the share"));
    if (share === undefined)
      throw new Error(`resources pause-at: a share from 0 to 1, or off\n${USAGE}`);
    args.resourcesPauseAt = share;
    return;
  }
  const pid = wholeNumber(operand(reader, "the pid"), 1, Number.MAX_SAFE_INTEGER);
  const ticks = wholeNumber(operand(reader, "the start ticks"), 0, Number.MAX_SAFE_INTEGER);
  if (pid === undefined || ticks === undefined)
    throw new Error(`resources end-orphan: the pid and the start ticks of an orphan\n${USAGE}`);
  args.orphanPid = pid;
  args.orphanTicks = ticks;
};

/** The one place `--confirm` goes on `host`: turning bypass permissions on. */
export function hostProblem(args: CliArgs): string | undefined {
  if (args.command !== "host" || args.confirm !== true) return undefined;
  return args.action === "bypass" && args.hostSwitch === "on"
    ? undefined
    : "--confirm: this flag only applies to flightdeckd host bypass on";
}

/** What `runHostCli` takes off the parsed line: a read (`host`) or one verb. */
export const hostCliArgs = (args: CliArgs): HostCliArgs => ({
  ...(args.json ? { json: true } : {}),
  ...(args.action === undefined
    ? {}
    : {
        action: args.action as NonNullable<HostCliArgs["action"]>,
        ...(args.hostMinutes !== undefined ? { minutes: args.hostMinutes } : {}),
        ...(args.hostSwitch !== undefined ? { on: args.hostSwitch === "on" } : {}),
        ...(args.confirm ? { confirm: true } : {}),
      }),
});
