import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { inSequence } from "@flightdeck/protocol";

/** One transcript file: a session's own, or one of its subagents' (`<id>/subagents/*.jsonl`). */
export interface TranscriptFile {
  path: string;
  claudeSessionId: string;
  subagent: boolean;
}

/** The size of a file, or null when it is gone. */
export const sizeOf = (path: string) =>
  stat(path).then(
    (info) => info.size,
    () => null,
  );

/** `length` bytes of the file from `offset`, read without holding the event loop. */
export async function readSlice(path: string, offset: number, length: number): Promise<Buffer> {
  const chunk = Buffer.alloc(length);
  const handle = await open(path, "r");
  try {
    await handle.read(chunk, 0, length, offset);
  } finally {
    await handle.close();
  }
  return chunk;
}

/** A folder's entries; none when it does not exist (a session folder without `subagents/`). */
const entries = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

/** The transcripts of one project folder: its sessions' files and their subagents' files. */
async function projectFiles(project: string): Promise<TranscriptFile[]> {
  const files: TranscriptFile[] = [];
  await inSequence(await entries(project), async (item) => {
    if (item.isFile() && item.name.endsWith(".jsonl")) {
      const path = join(project, item.name);
      files.push({ path, claudeSessionId: basename(item.name, ".jsonl"), subagent: false });
    } else if (item.isDirectory()) {
      const subagents = join(project, item.name, "subagents");
      for (const sub of await entries(subagents)) {
        if (!sub.isFile() || !sub.name.endsWith(".jsonl")) continue;
        files.push({ path: join(subagents, sub.name), claudeSessionId: item.name, subagent: true });
      }
    }
  });
  return files;
}

/** Every transcript and subagent transcript under the roots, one folder per project. */
export async function listTranscripts(roots: readonly string[]): Promise<TranscriptFile[]> {
  const files: TranscriptFile[] = [];
  await inSequence(roots, async (root) => {
    await inSequence(await entries(root), async (dir) => {
      if (dir.isDirectory()) files.push(...(await projectFiles(join(root, dir.name))));
    });
  });
  return files;
}
