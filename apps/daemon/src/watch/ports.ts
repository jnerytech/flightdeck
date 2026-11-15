import type { BoardColumn, Card, PersonaRef, Project } from "@flightdeck/protocol";

/**
 * What the PR watch asks of the board (#1589). The watch owns this port, so it imports nothing
 * from the board: the board's check loop can import the watch's entry without a cycle, and
 * `main.ts` hands the real board over, which fits it structurally.
 */
export interface WatchBoard {
  getCard(id: string): Card;
  getProject(id: string): Project;
  onPrRound(listener: () => void): () => void;
  moveCard(id: string, column: BoardColumn): Card;
  /** Runs a fix session for the card: how its first turn ended. */
  fixCard(
    id: string,
    opts: { prompt: string; persona?: PersonaRef },
  ): Promise<{ sessionId: string | null; costUsd: number; isError: boolean; error: string | null }>;
}
