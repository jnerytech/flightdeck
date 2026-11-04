/** One React key per entry of `ids`, which may repeat. */
export function uniqueKeys(ids: readonly string[]): string[] {
  return [...ids];
}
