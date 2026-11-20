/** The credential helper shipped beside the app (issue #3429): where it may be run from, and what it is asked. */
import type { Exec } from "../kernel/index.ts";

/** What the helper gave for one host: the address, and the token only through a function, so no log or `JSON.stringify` of this object shows it. */
export interface RemoteCredential {
  url: string;
  token: () => string;
}

/** The first of `candidates` that is a helper this user may run, or null. `uid` is the user running the CLI (null on Windows). */
export async function locateHelper(
  _candidates: readonly string[],
  _check: { platform: string; uid: number | null },
): Promise<string | null> {
  return null;
}

/** The address and the token of host `id`, asked of the helper with a fixed command line, or null for any failure. */
export async function readCredential(
  _exec: Exec,
  _helper: string,
  _id: string,
): Promise<RemoteCredential | null> {
  return null;
}
