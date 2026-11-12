import type { Card } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import { queueSplit } from "../../lib/board-bulk.ts";
import { answerOf, type BulkRefusal } from "../../lib/board-select.ts";

/** A host that could start the cards that would wait here, with its project of the same repository. */
export interface Elsewhere {
  hostId: string;
  name: string;
  projectId: string;
}

/** What the app knows of one other host when it decides whether to offer it. */
export interface HostFacts {
  id: string;
  name: string;
  online: boolean;
  paused: boolean;
  projects: Array<{ id: string; key: string }>;
  /** `maxParallelRuns`; null when the host did not say it. */
  limit: number | null;
  /** Cards running on the host now. */
  running: number;
}

export type ElsewhereAnswer =
  | { ok: true; data: unknown }
  | { ok: false; message: string; reason?: string; params?: Record<string, string | number> };

export type ElsewhereAsk = (
  hostId: string,
  type: "card.create" | "card.start" | "card.delete" | "card.update" | "card.move",
  payload: Record<string, unknown>,
) => Promise<ElsewhereAnswer>;

export interface ElsewhereOutcome {
  /** The cards that now run (or queue) on the target, with the id of the card made there. */
  moved: Array<{ card: Card; as: string }>;
  refused: BulkRefusal[];
  /** Started on the target, but the source card could not be marked or moved. */
  unmarked: Card[];
  /** A copy made on the target that could not be removed after its start was refused. */
  orphaned: Card[];
}

/**
 * The startable cards that would wait on this host: all of them when it holds new runs (paused,
 * memory, budget), else the ones past its free places. A limit the host did not say gives none: the
 * app cannot tell they would wait.
 */
export function waitingCards(
  startable: Card[],
  host: { held: boolean; max: number | null; running: number },
): Card[] {
  if (host.held) return startable;
  if (host.max === null) return [];
  return startable.slice(queueSplit(startable.length, host.max, host.running).now);
}

/**
 * A card can leave only when it starts the same way there and its going changes nothing here: a
 * template's workflow or persona would be lost, a blocker it waits on would not exist on the target,
 * and a card that holds others up would free them by going to Done.
 */
const startsAsIs = (card: Card) =>
  !card.startWorkflow &&
  !card.startPersona &&
  (card.waitingOn?.length ?? 0) === 0 &&
  (card.blocking?.length ?? 0) === 0;

/**
 * The hosts the waiting cards can go to: another online host that is not paused, has a project of
 * the same repository and enough free places for all of them.
 */
export function offeredHosts(input: {
  waiting: Card[];
  sourceHostId: string;
  sourceKey: string | null;
  hosts: HostFacts[];
}): Elsewhere[] {
  const { waiting, sourceHostId, sourceKey } = input;
  if (waiting.length === 0 || sourceKey === null || !waiting.every(startsAsIs)) return [];
  const offered: Elsewhere[] = [];
  for (const host of input.hosts) {
    if (host.id === sourceHostId || !host.online || host.paused || host.limit === null) continue;
    if (host.limit - host.running < waiting.length) continue;
    const project = host.projects.find((p) => p.key === sourceKey);
    if (project) offered.push({ hostId: host.id, name: host.name, projectId: project.id });
  }
  return offered;
}

/**
 * Hands the cards to the target one at a time, in order (#1422). The card is made and started
 * there; only when the target accepts the start is the source marked "Started on <host> as <id>" and
 * moved to Done, never deleted. A refused start removes the card made there (it never ran).
 */
export async function startElsewhere(run: {
  t: T;
  cards: Card[];
  sourceHostId: string;
  target: Elsewhere;
  ask: ElsewhereAsk;
}): Promise<ElsewhereOutcome> {
  const { t, target, ask } = run;
  const outcome: ElsewhereOutcome = { moved: [], refused: [], unmarked: [], orphaned: [] };
  for (const card of run.cards) {
    const made = await ask(target.hostId, "card.create", {
      // NOSONAR: one card at a time, so the target's queue sees them in the board's order
      projectId: target.projectId,
      title: card.title,
      description: card.description,
    });
    if (!made.ok) {
      outcome.refused.push({ card, ...answerOf(made) });
      continue;
    }
    const as = (made.data as { id: string }).id;
    const started = await ask(target.hostId, "card.start", { cardId: as });
    if (!started.ok) {
      const removed = await ask(target.hostId, "card.delete", { cardId: as, confirm: true });
      if (!removed.ok) outcome.orphaned.push(card);
      outcome.refused.push({ card, ...answerOf(started) });
      continue;
    }
    outcome.moved.push({ card, as });
    const note = t("board.startedElsewhere", { host: target.name, id: as });
    const marked = await ask(run.sourceHostId, "card.update", {
      cardId: card.id,
      description: [card.description, note].join("\n\n"),
    });
    const done =
      marked.ok &&
      (await ask(run.sourceHostId, "card.move", { cardId: card.id, column: "done" })).ok;
    if (!done) outcome.unmarked.push(card);
  }
  return outcome;
}

/** The line after a hand-off: how many started there, which did not, and which stay on the board. */
export function elsewhereNotice(
  t: T,
  outcome: ElsewhereOutcome,
  host: string,
  name: (refused: BulkRefusal[]) => string,
): string | null {
  const { moved, refused, unmarked, orphaned } = outcome;
  const parts: string[] = [];
  if (moved.length === 1) parts.push(t("board.elsewhereDoneOne", { host }));
  else if (moved.length > 1) parts.push(t("board.elsewhereDone", { count: moved.length, host }));
  if (refused.length === 1) parts.push(t("board.startFailedOne", { names: name(refused) }));
  else if (refused.length > 1) {
    parts.push(t("board.startFailed", { count: refused.length, names: name(refused) }));
  }
  if (unmarked.length > 0) {
    parts.push(t("board.elsewhereUnmarked", { names: unmarked.map((c) => c.title).join(", ") }));
  }
  if (orphaned.length > 0) {
    parts.push(
      t("board.elsewhereOrphaned", { host, names: orphaned.map((c) => c.title).join(", ") }),
    );
  }
  return parts.length === 0 ? null : parts.join(" ");
}
