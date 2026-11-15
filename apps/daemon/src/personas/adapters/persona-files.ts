import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { byCodeUnit } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";

/**
 * A project's versioned personas, one `<id>.md` each under `.flightdeck/personas` (#1589). Every
 * function takes the project folder the store already resolved against the allowed roots and
 * builds the path itself, from an id that matches the id pattern or a name that is one plain
 * `.md` file name: no caller hands it a path.
 */

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_FILE_BYTES = 64 * 1024;

const invalidId = () => new FlightdeckError("bad_request", "invalid id", "persona_id_invalid");

/** The folder of a project's personas. */
export const personaDir = (project: string) => join(project, ".flightdeck", "personas");

/** The file of one persona; an id that is not a persona id never becomes a path. */
function fileOf(project: string, id: string): string {
  if (!ID.test(id)) throw invalidId();
  return join(personaDir(project), `${id}.md`);
}

/** The `.md` files of the folder, in code unit order; null when the folder is not there. */
export async function listPersonaNames(project: string): Promise<string[] | null> {
  const names = await readdir(personaDir(project)).then(
    (entries) => entries,
    () => null,
  );
  return names === null ? null : names.filter((entry) => entry.endsWith(".md")).sort(byCodeUnit);
}

/** The text of a file the folder lists; a file over the size limit is refused. */
export async function readPersonaSource(project: string, name: string): Promise<string> {
  if (!name.endsWith(".md") || basename(name) !== name) throw invalidId();
  const path = join(personaDir(project), name);
  if ((await stat(path)).size > MAX_FILE_BYTES) {
    throw new FlightdeckError("bad_request", "file too big", "persona_file_big");
  }
  return await readFile(path, "utf8");
}

export async function writePersonaFile(project: string, id: string, source: string): Promise<void> {
  await mkdir(personaDir(project), { recursive: true });
  await writeFile(fileOf(project, id), source);
}

/** False when the persona has no file. */
export async function removePersonaFile(project: string, id: string): Promise<boolean> {
  const path = fileOf(project, id);
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
