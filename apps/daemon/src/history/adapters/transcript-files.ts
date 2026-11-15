import { stat as fileStat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inSequence } from "@flightdeck/protocol";

const entries = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

/** Every `<claudeSessionId>.jsonl` under `<root>/<project>/`, root by root. */
export async function listTranscripts(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  await inSequence(roots, async (root) => {
    await inSequence(await entries(root), async (dir) => {
      if (!dir.isDirectory()) return;
      for (const file of await entries(join(root, dir.name))) {
        if (file.isFile() && file.name.endsWith(".jsonl")) {
          files.push(join(root, dir.name, file.name));
        }
      }
    });
  });
  return files;
}

export async function transcriptStat(path: string): Promise<{ size: number; mtime: Date }> {
  return fileStat(path);
}

/**
 * Reads the next `maxBytes` of a file from `offset`, up to its last whole line (a line bigger than
 * that is read whole). `end` is the byte count of whole lines in `chunk`; a last line without its
 * newline is left for the next pass.
 */
export async function readSlice(
  path: string,
  offset: number,
  size: number,
  maxBytes: number,
): Promise<{ chunk: Buffer; end: number }> {
  let chunk = Buffer.alloc(Math.min(size - offset, maxBytes));
  let end = 0;
  for (;;) {
    const handle = await open(path, "r"); // NOSONAR: sequential by design: each pass needs the answer of the one before
    try {
      await handle.read(chunk, 0, chunk.length, offset); // NOSONAR: sequential by design: each pass needs the answer of the one before
    } finally {
      await handle.close(); // NOSONAR: sequential by design: each pass needs the answer of the one before
    }
    // Only complete lines: a last line without its newline is left for the next pass.
    end = chunk.lastIndexOf(0x0a) + 1;
    if (end > 0 || chunk.length >= size - offset) break;
    // No end of line in the slice: the line is bigger than it, so read on until it ends.
    chunk = Buffer.alloc(Math.min(size - offset, chunk.length * 2));
  }
  return { chunk, end };
}
