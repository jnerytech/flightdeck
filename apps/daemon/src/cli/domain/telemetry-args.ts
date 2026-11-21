/**
 * Issue #3755: what `flightdeckd telemetry` takes. `session` and `summary` ask the daemon (`--json`, `--host`);
 * `install`, `uninstall` and `status` edit and read this machine's Claude Code settings, so those flags make
 * no sense there. The parser in `args.ts` adds the usage text to the problem this names.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

/** `telemetry <install|uninstall|status|session|summary>`; `session` takes the Claude session id. */
export function readTelemetry(args: CliArgs, reader: ArgReader): void {
  args.command = "telemetry";
  const action = subAction(
    reader,
    ["install", "uninstall", "status", "session", "summary"] as const,
    "invalid telemetry action",
  );
  args.action = action;
  if (action === "session") args.telemetryId = operand(reader, "the session");
}

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface TelemetryArgs {
  command: string;
  action?: string;
  json?: boolean;
  host?: string;
}

/** What is wrong with the flags of `telemetry`: `--json` or `--host` on a verb that works on this machine's settings. */
export function telemetryProblem(args: TelemetryArgs): string | undefined {
  if (args.command !== "telemetry" || args.action === "session" || args.action === "summary")
    return undefined;
  for (const [flag, given] of [
    ["--json", args.json === true],
    ["--host", args.host !== undefined],
  ] as const)
    if (given)
      return `${flag}: this flag only applies to flightdeckd telemetry session and summary`;
  return undefined;
}
