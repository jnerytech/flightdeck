/**
 * Issue #3752: the sentence a request to `action save` carries about the definition file it names, so a person
 * approves the saved command and not a path. This is the adapter: it reads the file (the rule that rates the
 * request stays pure, `domain/action-risk.ts`), and `domain/action-save-view.ts` words what it read.
 */
import { isAbsolute, resolve } from "node:path";
import { readRegularSized } from "../kernel/index.ts";
import {
  describeDefinition,
  hasStepsBeforeSave,
  savedDefinitionFiles,
} from "./domain/action-save-view.ts";
import { SHELL_TOOLS } from "./domain/risk.ts";

/** A definition is a few lines; a file past this is not shown, whatever it holds. */
const LIMIT = 256 * 1024;

/** The most saves of one command line that are read: a line with more says how many were left. */
const MOST_SAVES = 5;

/**
 * A regular file of at most 256 KiB, as text; null for anything else (a link, a pipe, a folder, a missing or a huge
 * file). A pipe is never opened for waiting: a session could name one and hold the request back.
 */
export async function readDefinitionFile(path: string): Promise<string | null> {
  const read = await readRegularSized(path, LIMIT + 1).catch(() => null);
  return read === null || read.size > LIMIT ? null : read.data.toString("utf8");
}

/** What the file reads as, or null when the reader failed: a failure says "could not be shown", never throws. */
async function readOrNull(
  read: (path: string) => Promise<string | null>,
  path: string,
): Promise<string | null> {
  try {
    return await read(path);
  } catch {
    return null;
  }
}

/**
 * The sentence about each definition file the command's `action save` names, read from the session's folder;
 * undefined (and nothing read) for a command that saves nothing.
 */
export function actionSaveNote(
  command: string,
  cwd: string,
  read: (path: string) => Promise<string | null> = readDefinitionFile,
): Promise<string> | undefined {
  const files = savedDefinitionFiles(command);
  if (files.length === 0) return undefined;
  const shown = files.slice(0, MOST_SAVES);
  const left = files.length - shown.length;
  return Promise.all(
    shown.map(async (file) =>
      describeDefinition(
        file,
        file === null ? null : await readOrNull(read, resolve(cwd, file)),
        file === null || isAbsolute(file) ? undefined : cwd,
      ),
    ),
  ).then((notes) =>
    [
      ...notes,
      ...(hasStepsBeforeSave(command)
        ? [
            `the command also runs other steps before the save, which may change these files after this was read: deny it unless you know what they do`,
          ]
        : []),
      ...(left > 0
        ? [
            `${left} more saves in this command were not read: deny it unless you know what they hold`,
          ]
        : []),
    ].join(" | "),
  );
}

/** The note for a request of a shell tool (`Bash`, `PowerShell`); undefined for any other tool or a command with no save. */
export function explainShellRequest(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): Promise<string> | undefined {
  if (!SHELL_TOOLS.has(toolName) || typeof input.command !== "string") return undefined;
  return actionSaveNote(input.command, cwd);
}
