/** Issue #3752: the sentence a request to `action save` carries about the definition file it names. */
export function actionSaveNote(
  _command: string,
  _cwd: string,
  _read: (path: string) => Promise<string | null> = readDefinitionFile,
): Promise<string> | undefined {
  return undefined;
}

/** A regular file of at most 256 KiB, as text; null for anything else (a pipe, a folder, a missing or a huge file). */
export function readDefinitionFile(_path: string): Promise<string | null> {
  return Promise.resolve("");
}
