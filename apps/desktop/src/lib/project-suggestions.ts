/** The folders worth offering as a new project: where the host's recent sessions ran. */
export function suggestFolders(
  _sessions: ReadonlyArray<{ cwd: string; updatedAt: string }>,
  _roots: readonly string[],
  _projects: ReadonlyArray<{ path: string }>,
): string[] {
  return [];
}
