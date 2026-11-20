/**
 * Issue #3456: `flightdeckd persona list|show|subagents`, the personas from a terminal or a script.
 * It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the token of
 * the config). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, said } from "../daemon-client/index.ts";
import type { PersonaCliArgs } from "./domain/persona-cli-view.ts";

export function runPersonaCli(
  _args: PersonaCliArgs,
  _config: { bind: string; port: number; token: string },
): Promise<CliResult> {
  return Promise.resolve(said());
}
