import { randomUUID } from "node:crypto";
import { chmod, realpath, rename, rm, stat, writeFile } from "node:fs/promises";

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

/** Where the file really is (the file a link points to) and the mode it has, or nothing when it does not exist yet. */
async function existing(path: string): Promise<{ real: string; mode: number } | null> {
  try {
    const real = await realpath(path);
    return { real, mode: (await stat(real)).mode & 0o7777 };
  } catch {
    return null;
  }
}

/**
 * Writes a file so a reader sees the old content or the new one, never half of it: the data goes
 * to a file of its own beside it, and a rename puts it in place. A link is followed (the file it
 * points to is the one replaced, the link stays) and the file keeps the mode it had.
 */
export async function writeFileAtomic(
  path: string,
  data: string,
  io: Partial<AtomicIo> = {},
): Promise<void> {
  const found = await existing(path);
  const target = found?.real ?? path;
  const mode = io.mode ?? found?.mode;
  const write =
    io.write ??
    (async (to, text) => {
      await writeFile(to, text, mode ? { mode } : {});
      // The mode of writeFile is cut by the umask: the file keeps exactly what it had.
      if (mode) await chmod(to, mode);
    });
  const move = io.rename ?? rename;
  const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await write(tmp, data);
    for (let attempt = 1; ; attempt++) {
      try {
        await move(tmp, target);
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
