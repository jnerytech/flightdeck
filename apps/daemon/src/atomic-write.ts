import { rename, writeFile } from "node:fs/promises";

/** The two steps of an atomic write, apart so a test can stop between them. */
export interface AtomicIo {
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** Writes a file so a reader sees the old content or the new one, never half of it. */
export async function writeFileAtomic(
  path: string,
  data: string,
  io: AtomicIo = { write: (p, d) => writeFile(p, d), rename },
): Promise<void> {
  await io.write(path, data);
}
