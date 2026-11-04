/** One React key per entry of `ids`, which may repeat: the first keeps its id, later ones get a count. */
export function uniqueKeys(ids: readonly string[]): string[] {
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  return ids.map((id) => {
    let key = id;
    while (taken.has(key)) {
      const times = (counts.get(id) ?? 1) + 1;
      counts.set(id, times);
      key = `${id}#${times}`;
    }
    taken.add(key);
    return key;
  });
}
