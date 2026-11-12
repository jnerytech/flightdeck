import type { Card } from "@flightdeck/protocol";

/** One blocker in the chain under a card, with the blockers it waits for in turn. */
export interface ChainNode {
  card: Card;
  children: ChainNode[];
}

/** Whether `from` waits for `target`, directly or down its chain of blockers. */
function waitsFor(
  byId: Map<string, Card>,
  from: Card,
  target: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(from.id)) return false;
  seen.add(from.id);
  return from.blockedBy.some((id) => {
    const next = byId.get(id);
    return id === target || (next !== undefined && waitsFor(byId, next, target, seen));
  });
}

/** The cards that can be added as blockers of `card`: none that would close a cycle. */
export function pickable(cards: Card[], card: Card): Card[] {
  const byId = new Map(cards.map((other) => [other.id, other]));
  return cards.filter(
    (other) =>
      other.id !== card.id &&
      other.projectId === card.projectId &&
      other.arenaOf === null &&
      !card.blockedBy.includes(other.id) &&
      !waitsFor(byId, other, card.id),
  );
}

/** The blockers of `card` as a tree to `depth` levels, and how many more lie deeper. */
export function chainOf(
  cards: Card[],
  card: Card,
  depth = 3,
): { nodes: ChainNode[]; more: number } {
  const byId = new Map(cards.map((other) => [other.id, other]));
  const deeper = new Set<string>();
  const walk = (of: Card, level: number, path: Set<string>): ChainNode[] =>
    of.blockedBy.flatMap((id) => {
      const next = byId.get(id);
      if (!next || path.has(id)) return [];
      if (level >= depth) {
        deeper.add(id);
        return [];
      }
      return [{ card: next, children: walk(next, level + 1, new Set([...path, id])) }];
    });
  const nodes = walk(card, 0, new Set([card.id]));
  // What lies beyond the last level: every card reachable below it, once.
  const countBelow = (of: Card, seen: Set<string>) => {
    for (const id of of.blockedBy) {
      const next = byId.get(id);
      if (!next || seen.has(id)) continue;
      seen.add(id);
      countBelow(next, seen);
    }
  };
  const beyond = new Set<string>();
  for (const id of deeper) {
    beyond.add(id);
    const next = byId.get(id);
    if (next) countBelow(next, beyond);
  }
  return { nodes, more: beyond.size };
}
