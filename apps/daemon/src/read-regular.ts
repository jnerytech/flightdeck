/**
 * Reads a regular file without ever following a link: a link, a folder, a pipe, a device or a
 * missing file is null and is never opened (a pipe would block, a link could point anywhere).
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

/** `O_NOFOLLOW` refuses a link swapped in after the check; `O_NONBLOCK` keeps a swapped-in pipe from blocking. Neither exists on Windows. */
const FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** What a path that cannot be looked at or opened reads as. */
const none = () => null;

/** At most the first `max` bytes of the regular file at `path`, or null when it is anything else. */
export async function readRegular(path: string, max: number): Promise<Buffer | null> {
  const info = await lstat(path).catch(none);
  if (!info?.isFile()) return null;
  const handle = await open(path, FLAGS).catch(none);
  try {
    const opened = await handle?.stat();
    if (!handle || !opened?.isFile()) return null;
    const bytes = Buffer.alloc(Math.min(max, opened.size));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle?.close();
  }
}
