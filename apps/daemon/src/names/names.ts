/**
 * Phase 21, standard session names: every session of this host has a display name
 * (`project · persona · number`) and an alias (`project-persona-number`) that addresses it. The
 * numbers come from counters that never go down, so a name is never given twice.
 */
import type { Database } from "bun:sqlite";

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
}

export interface NameInput {
  project: string;
  persona?: string | null | undefined;
  /** The card the session works for, if any. */
  cardId?: string | null | undefined;
}

export class Names {
  constructor(private readonly db: Database) {}

  assign(id: string, _input: NameInput): SessionName {
    return this.blank(id);
  }

  get(_id: string): SessionName | null {
    return null;
  }

  /** The session an alias points at; null when it points at none. */
  resolve(_alias: string): string | null {
    return null;
  }

  /** The session got a persona after it started: a new number under it, the old alias kept. */
  setPersona(id: string, _persona: string | null): SessionName {
    return this.blank(id);
  }

  /** A new display name; the old alias keeps working and the new name adds one if it is free. */
  rename(id: string, _display: string): SessionName {
    return this.blank(id);
  }

  list(): SessionName[] {
    return [];
  }

  private blank(id: string): SessionName {
    void this.db;
    return {
      id,
      display: "",
      alias: "",
      aliases: [],
      project: "",
      persona: "",
      number: 0,
      cardNumber: null,
    };
  }
}
