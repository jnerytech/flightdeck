import type { CommandPayload } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { Board } from "./board.ts";
import type { Card } from "./types.ts";

export interface ManageDeps {
  board: Board;
  /** The folder a managed session runs in; `null` when the id is not one the manager knows. */
  cwdOf(sessionId: string): string | null;
}

const refuse = (reason: string, message: string): FlightdeckError =>
  new FlightdeckError("invalid_state", message, reason);

const needs = (what: string): FlightdeckError =>
  refuse("card_manage_args", `this action needs ${what}`);

/** `YYYY-MM-DD HH:MM`, UTC: the stamp of a note on a card. */
const stamp = (): string => new Date().toISOString().slice(0, 16).replace("T", " ");

type Payload = CommandPayload<"card.manage">;

/** The card the call is about, once it is in the project the session runs in. */
function scopedCard(deps: ManageDeps, payload: Payload): Card {
  const { board } = deps;
  // A managed session's own folder wins over the one a client says.
  const cwd = (payload.as.session ? deps.cwdOf(payload.as.session) : null) ?? payload.cwd;
  const found = cwd ? board.projectForCwd(cwd) : null;
  if (!found) {
    throw refuse("card_scope_unknown", "this session does not run in a project of this host");
  }
  const cardId = payload.cardId ?? found.card?.id;
  if (!cardId) throw refuse("card_id_needed", "this session is not in a card: name the cardId");
  const card = board.getCard(cardId);
  if (card.projectId !== found.project.id) {
    throw refuse("card_other_project", "the card belongs to another project than this session's");
  }
  return card;
}

/** The title and the description a call names; a field it leaves out is left out. */
function titleAndDescription(payload: Payload): { title?: string; description?: string } {
  const changes: { title?: string; description?: string } = {};
  if (payload.title !== undefined) changes.title = payload.title;
  if (payload.description !== undefined) changes.description = payload.description;
  return changes;
}

/** The change the call asks for, with what each action needs checked first. */
async function applyAction(board: Board, card: Card, payload: Payload): Promise<Card> {
  const cardId = card.id;
  switch (payload.action) {
    case "move":
      if (!payload.column) throw needs("a column");
      return board.moveCard(cardId, payload.column);
    case "update":
      if (payload.title === undefined && payload.description === undefined) {
        throw needs("a title or a description");
      }
      return board.updateCard(cardId, titleAndDescription(payload));
    case "comment":
      if (!payload.text) throw needs("a text");
      return board.updateCard(cardId, {
        description: `${card.description}\n\n**Note ${stamp()}:** ${payload.text}`,
      });
    case "finish":
      if (!payload.outcome) throw needs("an outcome (done or discard)");
      return payload.outcome === "done"
        ? board.completeCard(cardId, true)
        : board.discardCard(cardId, true);
  }
}

/**
 * A session's own management of the cards of its project (the flightdeck MCP server's card
 * tools): one project only, its own card by default. The rules are the board's own: moving
 * is `card.move`, finishing is `card.complete` or `card.discard`.
 */
export async function manageCard(deps: ManageDeps, payload: Payload): Promise<Card> {
  return await applyAction(deps.board, scopedCard(deps, payload), payload);
}
