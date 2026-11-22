/**
 * Issue #3781: `flightdeckd ui set`, the words after the noun and the flags only it takes (`--lock`, `--unlock`
 * and, on `ui`, `--mode full|simple`, which `file search` reads as name or content).
 */
import type { UiCliArgs } from "../../ui/index.ts";
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import { type Handler, setFlag } from "./flag-handlers.ts";
import { USAGE } from "./usage.ts";

export function readUi(args: CliArgs, reader: ArgReader): void {
  args.command = "ui";
  args.action = subAction(reader, ["set"] as const, "invalid ui action");
}

/** `ui set --mode`: the mode the host starts in. */
export function readUiMode(args: CliArgs, value: string): void {
  if (value !== "full" && value !== "simple")
    throw new Error(`--mode: full or simple, got ${value}\n${USAGE}`);
  args.uiMode = value;
}

/** `--lock` and `--unlock` are one field: the one that was given first is refused when the other comes. */
const lockFlag = (locked: boolean, other: string): Handler =>
  setFlag((args) => {
    if (args.uiLock === !locked)
      throw new Error(`--lock and --unlock: not both (${other} was given)\n${USAGE}`);
    args.uiLock = locked;
  });

export const UI_FLAGS: Record<string, Handler> = {
  "--lock": lockFlag(true, "--unlock"),
  "--unlock": lockFlag(false, "--lock"),
};

/** What is wrong with the `ui` words and flags, or undefined: one change at least, and the confirm. */
export function uiProblem(args: CliArgs): string | undefined {
  if (args.command !== "ui") {
    if (args.uiLock === undefined) return undefined;
    const flag = args.uiLock ? "--lock" : "--unlock";
    return `${flag}: this flag only applies to flightdeckd ui set`;
  }
  if (args.uiMode === undefined && args.uiLock === undefined)
    return "ui set: needs --mode, --lock or --unlock";
  if (args.confirm !== true)
    return "ui set: needs --confirm: it changes how the host presents itself";
  return undefined;
}

export function uiCliArgs(args: CliArgs): UiCliArgs {
  return {
    action: "set",
    ...(args.uiMode === undefined ? {} : { mode: args.uiMode }),
    ...(args.uiLock === undefined ? {} : { locked: args.uiLock }),
    ...(args.json ? { json: true as const } : {}),
  };
}
