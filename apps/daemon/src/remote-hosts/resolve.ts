/**
 * `--host <name>` (issue #3429): the name becomes a host to ask, with its address judged and its token
 * in a closure, or a refusal with a stable reason. Exit codes: 1 refused (unknown name, no store, an
 * address that may not carry the token).
 */
import { type CliResult, failure, type RemoteTarget } from "../daemon-client/index.ts";
import type { Exec } from "../kernel/index.ts";
import type { PathsEnv } from "./domain/paths.ts";

export interface ResolveDeps {
  env: PathsEnv;
  /** The user running the CLI; null where the system has no user id (Windows). */
  uid: number | null;
  /** Runs the credential helper. */
  exec: Exec;
}

export type Resolved = { ok: true; target: RemoteTarget } | { ok: false; result: CliResult };

export async function resolveHost(_name: string, _deps: ResolveDeps): Promise<Resolved> {
  return { ok: false, result: failure(1, "", "unknown_host") };
}
