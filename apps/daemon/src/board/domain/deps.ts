/** The most blockers a card can have (phase 31). */
export const MAX_BLOCKERS = 20;

/**
 * The path that would close a cycle if `cardId` were blocked by `blockerId`: the card, the
 * blocker, and the blockers' blockers down to the card again. `null` when there is none.
 * `blockersOf` reads the links as they are stored, so a replaced set is read without the
 * links that are about to go.
 */
export function cyclePath(
  cardId: string,
  blockerId: string,
  blockersOf: (id: string) => readonly string[],
): string[] | null {
  if (blockerId === cardId) return [cardId, cardId];
  const seen = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === cardId) return [...path, id];
    if (seen.has(id)) return null;
    seen.add(id);
    for (const next of blockersOf(id)) {
      const found = walk(next, [...path, id]);
      if (found) return found;
    }
    return null;
  };
  const found = walk(blockerId, []);
  return found ? [cardId, ...found] : null;
}
