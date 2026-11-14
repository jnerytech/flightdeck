/**
 * Phase 21, issue #1601: what the naming of the sessions needs from the store of the names, so the
 * tracking rules (track.ts) stay pure. `Names` (names.ts, over SQLite) is the adapter.
 */
import type { SessionTeam } from "@flightdeck/protocol";

export interface SessionName {
  id: string;
  display: string;
  /** The first alias, which came with the session. */
  alias: string;
  /** Every alias that points at the session, the old ones of a rename included. */
  aliases: string[];
  project: string;
  persona: string;
  number: number;
  cardNumber: number | null;
  standard: boolean;
  team: SessionTeam | null;
}

export interface NameInput {
  project: string;
  persona?: string | null;
  /** The team the session works in (issue #101). */
  team?: SessionTeam | null;
  /** The card the session works for, if any. */
  cardId?: string | null;
}

/** The names' store as the tracking reads and writes it. */
export interface NamesPort {
  /** The name of a session, or null when it has none yet. */
  get(id: string): SessionName | null;
  /** Names a session the first time; the same name ever after. */
  assign(id: string, input: NameInput): SessionName;
  /** Takes the title Claude Code gave a session (issue #605). */
  adoptTitle(id: string, title: string, kind: "custom" | "agent"): void;
}
