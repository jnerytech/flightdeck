import type { BoardColumn, Card, ChecksState, PrState } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";

export const COLUMNS: ReadonlyArray<{ id: BoardColumn; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "in_progress", label: "Em andamento" },
  { id: "waiting", label: "Esperando você" },
  { id: "review", label: "Em revisão" },
  { id: "done", label: "Concluído" },
];

export const PR_LABELS: Record<PrState, string> = {
  open: "PR aberto",
  merged: "PR mesclado",
  closed: "PR fechado",
};

export const CHECK_LABELS: Record<ChecksState, string> = {
  pending: "checks pendentes",
  passing: "checks passando",
  failing: "checks falhando",
};

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
