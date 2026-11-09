import type { Card } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";
import type { BulkRefusal } from "./board-select.ts";

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
}

export function waitingCards(
  _startable: Card[],
  _host: { held: boolean; max: number | null; running: number },
): Card[] {
  return [];
}

export function offeredHosts(_input: {
  waiting: Card[];
  sourceHostId: string;
  sourceKey: string | null;
  hosts: HostFacts[];
}): Elsewhere[] {
  return [];
}

export async function startElsewhere(_run: {
  t: T;
  cards: Card[];
  sourceHostId: string;
  hostName: string;
  target: Elsewhere;
  ask: ElsewhereAsk;
}): Promise<ElsewhereOutcome> {
  return { moved: [], refused: [], unmarked: [] };
}
