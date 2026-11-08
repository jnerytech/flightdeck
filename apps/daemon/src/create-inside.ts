/**
 * Creates a new file inside a folder, never through a link and never over a file (#75, #78): the
 * harness apply and a card's spec template both write into a project this way.
 */
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { samePath } from "./paths.ts";

/** Not defined on Windows: there the folder checks stand alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** How the file is opened: a seam for a test that swaps a folder in between. */
export type OpenFile = (path: string, flags: number) => Promise<FileHandle>;

const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.then(
    (value) => value,
    () => null,
  );

/**
 * Creates `name` (relative, `/`-separated) under the real folder `root`, only if it is missing: each
 * folder on the way is made or found as a real folder (a link there is refused), and the file is
 * opened only if it does not exist. False, with nothing of the person's touched, when any of that
 * fails; at worst an empty file this call made is left where a swapped folder led.
 */
export async function createInside(
  root: string,
  name: string,
  content: string,
  openFile: OpenFile = (path, flags) => open(path, flags),
): Promise<boolean> {
  const names = name.split("/");
  let at = root;
  for (const segment of names.slice(0, -1)) {
    at = join(at, segment);
    await orNull(mkdir(at));
    const info = await orNull(lstat(at));
    if (info === null || !info.isDirectory()) return false;
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
  const handle = await orNull(openFile(join(at, names.at(-1) as string), flags));
  if (handle === null) return false;
  try {
    // A folder on the way swapped for a link since the loop: the new file is not where the path says.
    // It is still empty, and was made by this call (O_EXCL), so nothing of the person's is touched.
    if (!samePath((await orNull(realpath(at))) ?? "", at)) return false;
    await handle.writeFile(content);
    return true;
  } finally {
    await handle.close();
  }
}
