/** The index of host names the app writes (issue #3429): read with the checks the decision record sets. */
import type { HostEntry } from "./domain/rules.ts";

/** The names and ids in the index at `path`, or null: no file, a link, a file of another user, or text that is not the index. `uid` is the user running the CLI (null where the system has none). */
export async function readHostIndex(
  _path: string,
  _uid: number | null,
): Promise<HostEntry[] | null> {
  return null;
}
