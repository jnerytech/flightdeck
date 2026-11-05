import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/** The two steps of an atomic write, apart so a test can stop between them. */
export interface AtomicIo {
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** The file's permissions (a secret's file is 0600). */
  mode?: number;
}

/** Windows refuses to replace a file another process has open for a moment: it is tried again. */
const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);
const ATTEMPTS = 6;

/**
 * Writes a file so a reader sees the old content or the new one, never half of it: the data goes
 * to a file of its own beside it, and a rename puts it in place.
 */
export async function writeFileAtomic(
  path: string,
  data: string,
  io: Partial<AtomicIo> = {},
): Promise<void> {
  const write = io.write ?? ((to, text) => writeFile(to, text, io.mode ? { mode: io.mode } : {}));
  const move = io.rename ?? rename;
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await write(tmp, data);
    for (let attempt = 1; ; attempt++) {
      try {
        await move(tmp, path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!BUSY.has(code) || attempt >= ATTEMPTS) throw error;
        await Bun.sleep(25 * attempt);
      }
    }
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
