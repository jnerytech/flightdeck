/**
 * Issue #3752: what a person is shown when a session asks to run `flightdeckd action save`: the definition file's
 * `run`, `cwd`, `env` names and secret ids, not only its path. The functions here are pure; the adapter that reads
 * the file is `../action-save-note.ts`.
 */

/** The `--definition-file` of each `action save` in a command line; null where a save names none. */
export function savedDefinitionFiles(_command: string): Array<string | null> {
  return [];
}

/** One sentence about the definition in `text` (the file's content, or null when it could not be read). */
export function describeDefinition(_file: string | null, _text: string | null): string {
  return "";
}
