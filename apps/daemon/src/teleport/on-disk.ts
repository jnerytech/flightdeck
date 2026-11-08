/**
 * Issue #100: where a session's transcript is on disk when the history indexer has not recorded it
 * yet (an import just wrote it, or the indexer's next scan has not come): any project folder of
 * the history roots, under the session's id.
 */
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

/** The transcript of a session in any project folder of the history roots, or null. */
export async function onDisk(
  roots: readonly string[],
  claudeSessionId: string,
): Promise<string | null> {
  // A session id is a UUID: a name with a separator or a dot never reaches the path.
  if (!/^[0-9a-f-]{36}$/i.test(claudeSessionId)) return null;
  for (const root of roots) {
    // A root that is not there (yet) holds no transcript.
    const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const file = join(root, folder.name, `${claudeSessionId}.jsonl`);
      if (
        await access(file).then(
          () => true,
          () => false,
        )
      )
        return file;
    }
  }
  return null;
}
