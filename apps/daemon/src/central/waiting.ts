import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { TAIL_BYTES, type Tail } from "./domain/waiting.ts";

/**
 * The end of a transcript, at most `TAIL_BYTES`, with the first line dropped when the read began
 * inside the file (it is cut). `null` when the file cannot be read: never throws.
 */
export async function tailOfFile(path: string): Promise<Tail | null> {
  try {
    const info = await stat(path);
    // A pipe or a device blocks `open` until something writes: only a regular file is read.
    if (!info.isFile()) return null;
    const start = Math.max(0, info.size - TAIL_BYTES);
    // Non-blocking, and checked again on the handle: the path may have been swapped since the stat.
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) return null;
      const buffer = Buffer.alloc(info.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let text = buffer.subarray(0, bytesRead).toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
      return { text, size: info.size, mtimeMs: info.mtimeMs };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
