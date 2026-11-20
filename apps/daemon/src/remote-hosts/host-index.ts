/** The index of host names the app writes (issue #3429): read with the checks the decision record sets. */
import { lstat } from "node:fs/promises";
import { readRegular } from "../kernel/index.ts";
import { type HostEntry, parseHostIndex } from "./domain/rules.ts";

/** A name index of a few dozen hosts is a few KiB; a file past this is not one. */
const MAX_BYTES = 64 * 1024;

/** The names and ids in the index at `path`, or null: no file, a link, a file of another user, or text that is not the index. `uid` is the user running the CLI (null where the system has none). */
export async function readHostIndex(path: string, uid: number | null): Promise<HostEntry[] | null> {
  // `lstat` does not follow a link, so a link is not a file here; `readRegular` refuses one again at open.
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) return null;
  // The app writes it 0600: a file others can write could have its names swapped, and a command would reach another host.
  if (uid !== null && (info.uid !== uid || (info.mode & 0o022) !== 0)) return null;
  const data = await readRegular(path, MAX_BYTES);
  return data ? parseHostIndex(data.toString("utf8")) : null;
}
