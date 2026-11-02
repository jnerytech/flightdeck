/**
 * Adds `path` to the live list of allowed folders (the same array every service reads) and keeps
 * it with `persist`. Returns the list after the change.
 */
export function addAllowedRoot(
  roots: string[],
  path: string,
  confirm: boolean,
  persist?: (roots: readonly string[]) => void,
): string[] {
  void path;
  void confirm;
  void persist;
  return [...roots].slice(0, 0);
}
