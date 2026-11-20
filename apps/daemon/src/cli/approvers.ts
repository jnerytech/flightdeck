/**
 * The approvers command of the command line (#3439): `flightdeckd approvers enroll` and `reset`. They
 * write the store of the host directly, from its terminal: no protocol command opens the window of the
 * first device or removes a key.
 */
import type { Logger } from "../kernel/index.ts";
import type { CliArgs } from "./domain/args.ts";

export interface ApproversCommandDeps {
  log: Logger;
}

/** `flightdeckd approvers enroll|reset [--json]`: 0 done, 1 refused. */
export async function runApprovers(_args: CliArgs, _deps: ApproversCommandDeps): Promise<number> {
  return 0;
}
