/**
 * Files inside a folder, never through a link (#75, #78): the harness preview and apply and a card's
 * spec template read and create project files this way, and a new file never goes over one.
 */
import { type BigIntStats, constants } from "node:fs";
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

/** Where a walk inside a folder ends: missing, refused, or a plain file at `at` whose `lstat` was `info`. */
export type Walk =
  | { state: "absent" }
  | { state: "refused" }
  | { state: "file"; at: string; info: BigIntStats };

/**
 * A file inside the real folder `root`, walked one name at a time: missing, a plain file of at most
 * `max` bytes, or refused. A link anywhere on the way is refused, dangling or not, out of the folder
 * or into it, so what is read or written is where the path says.
 */
export async function walkInside(root: string, name: string, max: number): Promise<Walk> {
  let at = root;
  let info: BigIntStats | null = null;
  for (const segment of name.split("/")) {
    // What came before this name must be a folder.
    if (info !== null && !info.isDirectory()) return { state: "refused" };
    at = join(at, segment);
    info = await orNull(lstat(at, { bigint: true }));
    if (info === null) return { state: "absent" };
    if (info.isSymbolicLink()) return { state: "refused" };
  }
  if (!info?.isFile() || info.size > BigInt(max)) return { state: "refused" };
  return { state: "file", at, info };
}

/**
 * The text of a plain file inside `root` of at most `max` bytes; null when missing or refused. The
 * file must have one name only (a hard link may lie outside), and it is read through a handle that
 * follows no link and must be the very file the walk found, so a swap in between reads nothing.
 */
export async function readInside(root: string, name: string, max: number): Promise<string | null> {
  const found = await walkInside(root, name, max);
  if (found.state !== "file" || found.info.nlink !== 1n) return null;
  const flags = constants.O_RDONLY | NO_FOLLOW | (constants.O_NONBLOCK ?? 0);
  const handle = await orNull(open(found.at, flags));
  if (handle === null) return null;
  try {
    const info = await handle.stat({ bigint: true });
    const same = info.dev === found.info.dev && info.ino === found.info.ino;
    if (!same || !info.isFile() || info.nlink !== 1n || info.size > BigInt(max)) return null;
    // At most one byte past the cap: a file that grew since the stat is refused, not read whole.
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(max + 1), 0, max + 1, 0);
    return bytesRead > max ? null : buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
