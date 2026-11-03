import type { CommandPayload } from "@flightdeck/protocol";
import type { Board } from "./board.ts";
import type { Card } from "./types.ts";

export interface ManageDeps {
  board: Board;
  /** The folder a managed session runs in; `null` when the id is not one the manager knows. */
  cwdOf(sessionId: string): string | null;
}

/**
 * A session's own management of the cards of its project (the flightdeck MCP server's card
 * tools): one project only, its own card by default.
 */
export async function manageCard(
  deps: ManageDeps,
  payload: CommandPayload<"card.manage">,
): Promise<Card> {
  return deps.board.getCard(payload.cardId ?? "");
}
