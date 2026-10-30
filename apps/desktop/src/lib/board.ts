import type { BoardColumn, Card } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";

export const COLUMNS: ReadonlyArray<{ id: BoardColumn }> = [
  { id: "backlog" },
  { id: "in_progress" },
  { id: "waiting" },
  { id: "review" },
  { id: "done" },
];

/** The project's cards on one host, in board order. */
export function projectCards(state: AppState, hostId: string, projectId: string): Card[] {
  return Object.entries(state.cards)
    .filter(([key, card]) => key.startsWith(`${hostId}/`) && card.projectId === projectId)
    .map(([, card]) => card)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/** Cards whose title or description contain `text`, ignoring case. */
export function filterCards(cards: Card[], text: string): Card[] {
  const needle = text.trim().toLowerCase();
  return cards.filter((card) =>
    `${card.title}\n${card.description}`.toLowerCase().includes(needle),
  );
}

/** Position that puts a card right before `targetId` among `cards` (sorted, without it). */
export function positionBefore(cards: Card[], targetId: string): number {
  const index = cards.findIndex((card) => card.id === targetId);
  const target = cards[index]?.position ?? 0;
  const previous = cards[index - 1];
  return previous ? (previous.position + target) / 2 : target - 1;
}
