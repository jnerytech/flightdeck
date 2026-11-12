import type { Card } from "@flightdeck/protocol";
import { nullOnError } from "@/shared/lib/index.ts";

/** What the board's cards read and ask through the app's store. */
export interface BoardCardsCore {
  /** Board cards seen so far, keyed by `host/card`. */
  cards(): Record<string, Card>;
  /** Replaces the cards, as one change. */
  setCards(cards: Record<string, Card>): void;
  /** A host's connection, only its board request (the hosts' entry is in an import cycle, #1624); nothing when the host is not known. */
  connection(
    hostId: string,
  ): { request(method: "board.get", payload: { projectId: string }): Promise<unknown> } | undefined;
  /** The OS notification and the bell entry, opening the card (or its PR). */
  notify(
    notification: { title: string; body: string },
    route: { name: "card"; host: string; projectId: string; cardId: string },
    fallbackUrl: string | null | undefined,
  ): void;
  /** The translator; only the two keys of the notification (the i18n entry is in an import cycle, #1624). */
  t(): (key: "deps.notifyTitle" | "deps.notifyBody", vars?: { title: string }) => string;
}

/** A card's key in the state: `host/card`, the format of the sessions' `sessionKey` (not imported: the sessions domain imports the board's, #1624). */
const stateKey = (hostId: string, cardId: string) => `${hostId}/${cardId}`;

const isCard = (value: unknown): value is Card =>
  typeof value === "object" && value !== null && "column" in value && "projectId" in value;

/** Cards inside a command result: a card, a whole board or none. */
function cardsIn(result: unknown): Card[] {
  if (isCard(result)) return [result];
  const columns = (result as { columns?: Array<{ cards: Card[] }> } | undefined)?.columns ?? [];
  return columns.flatMap((column) => column.cards);
}

/**
 * The board cards the app has seen (#1596: a slice of the store): the ones a host sends
 * (`card.updated`), the ones a command answers with, and a board loaded on its own. A discarded
 * card leaves; a card the app knew that has just lost its last blocker is notified (phase 31).
 */
export class BoardCardsSlice {
  constructor(private readonly core: BoardCardsCore) {}

  /** A card a host sent or answered with: kept, or dropped when discarded. */
  onCard(hostId: string, card: Card): void {
    const { [stateKey(hostId, card.id)]: previous, ...others } = this.core.cards();
    // Phase 31: a card the app already knew has just lost its last blocker.
    if (!card.discarded && card.unblockedAt && previous && !previous.unblockedAt) {
      const t = this.core.t();
      this.core.notify(
        {
          title: t("deps.notifyTitle"),
          body: t("deps.notifyBody", { title: card.title }),
        },
        { name: "card", host: hostId, projectId: card.projectId, cardId: card.id },
        card.prUrl,
      );
    }
    const cards = card.discarded ? others : { ...others, [stateKey(hostId, card.id)]: card };
    this.core.setCards(cards);
  }

  /** The cards inside a command's result (a card, a whole board or none). */
  onResult(hostId: string, result: unknown): void {
    for (const card of cardsIn(result)) this.onCard(hostId, card);
  }

  /** #1220: one project's board on a host, its cards into the state (a host that fails says nothing). */
  async load(hostId: string, projectId: string): Promise<void> {
    const conn = this.core.connection(hostId);
    if (!conn) return;
    const board = await nullOnError(conn.request("board.get", { projectId }));
    this.onResult(hostId, board);
  }
}
