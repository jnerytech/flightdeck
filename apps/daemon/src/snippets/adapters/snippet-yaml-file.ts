import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What a project's versioned snippets file holds on disk, and the hash of those bytes. */
export interface SnippetFileBytes {
  path: string;
  hash: string;
  text: string;
}

const fileOf = (project: string) => join(project, ".flightdeck", "snippets.yaml");

/** The project's `.flightdeck/snippets.yaml`; null when it has none. */
export async function readSnippetFile(project: string): Promise<SnippetFileBytes | null> {
  const path = fileOf(project);
  if (
    !(await stat(path).then(
      () => true,
      () => false,
    ))
  )
    return null;
  const bytes = await readFile(path);
  return {
    path,
    hash: createHash("sha256").update(bytes).digest("hex"),
    text: bytes.toString("utf8"),
  };
}

export async function writeSnippetFile(project: string, text: string): Promise<void> {
  await mkdir(join(project, ".flightdeck"), { recursive: true });
  await writeFile(fileOf(project), text);
}
