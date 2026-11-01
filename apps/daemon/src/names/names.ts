/**
 * Phase 21, standard session names: every session of this host has a display name
 * (`project · persona · number`) and an alias (`project-persona-number`) that addresses it. The
 * numbers come from counters that never go down, so a name is never given twice.
 */
import type { Database } from "bun:sqlite";
import { FlightdeckError } from "../errors.ts";
import { aliasName, displayName, GENERAL, slug } from "./format.ts";

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
  persona?: string | null;
  /** The card the session works for, if any. */
  cardId?: string | null;
}

interface Row {
  session_id: string;
  display: string;
  project: string;
  persona: string;
  number: number;
  card_number: number | null;
}

/** Where the counter of the cards' numbers lives, next to the persona counters. */
const CARDS = "#card";
const NO_PROJECT = "sem-projeto";

export class Names {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /** The name of a session, made the first time it is seen and the same ever after. */
  assign(id: string, input: NameInput): SessionName {
    const existing = this.get(id);
    if (existing) return existing;
    const persona = input.persona?.trim() || GENERAL;
    this.db.transaction(() => {
      const cardNumber = input.cardId ? this.cardNumber(input.project, input.cardId) : null;
      this.insert(id, input.project, persona, cardNumber);
    })();
    return this.get(id) as SessionName;
  }

  get(id: string): SessionName | null {
    const row = this.db
      .query<Row, [string]>("SELECT * FROM session_names WHERE session_id = ?")
      .get(id);
    return row ? this.view(row) : null;
  }

  /** The session an alias points at, however it is written; null when it points at none. */
  resolve(alias: string): string | null {
    const row = this.db
      .query<{ session_id: string }, [string]>(
        "SELECT session_id FROM session_aliases WHERE alias = ?",
      )
      .get(slug(alias));
    return row?.session_id ?? null;
  }

  /** The session got a persona after it started: a new number under it, the old alias kept. */
  setPersona(id: string, persona: string | null): SessionName {
    const current = this.row(id);
    const next = persona?.trim() || GENERAL;
    if (next === current.persona) return this.view(current);
    this.db.transaction(() => {
      const number = this.number(current.project, next, current.card_number);
      const was = displayName(this.parts(current));
      const parts = { ...this.parts(current), persona: next, number };
      // A name the user gave stays; a standard one follows the persona.
      const display = current.display === was ? displayName(parts) : current.display;
      this.db
        .query("UPDATE session_names SET display = ?, persona = ?, number = ? WHERE session_id = ?")
        .run(display, next, number, id);
      this.addAlias(id, aliasName(parts));
    })();
    return this.get(id) as SessionName;
  }

  /** A new display name; the old alias keeps working and the new name adds one if it is free. */
  rename(id: string, display: string): SessionName {
    const current = this.row(id);
    const name = display.trim();
    if (!name) throw new FlightdeckError("bad_request", "o nome não pode ficar em branco");
    this.db.transaction(() => {
      this.db.query("UPDATE session_names SET display = ? WHERE session_id = ?").run(name, id);
      const alias = slug(name);
      if (alias) this.addAlias(id, alias);
    })();
    return this.view({ ...current, display: name });
  }

  list(): SessionName[] {
    return this.db
      .query<Row, []>("SELECT * FROM session_names ORDER BY rowid")
      .all()
      .map((row) => this.view(row));
  }

  // --- internals ---

  private row(id: string): Row {
    const row = this.db
      .query<Row, [string]>("SELECT * FROM session_names WHERE session_id = ?")
      .get(id);
    if (!row) throw new FlightdeckError("not_found", `a sessão ${id} não tem nome`);
    return row;
  }

  private parts(row: Row) {
    return {
      project: row.project,
      persona: row.persona,
      cardNumber: row.card_number,
      number: row.number,
    };
  }

  private view(row: Row): SessionName {
    const aliases = this.db
      .query<{ alias: string }, [string]>(
        "SELECT alias FROM session_aliases WHERE session_id = ? ORDER BY rowid",
      )
      .all(row.session_id)
      .map((a) => a.alias);
    return {
      id: row.session_id,
      display: row.display,
      alias: aliases[0] as string,
      aliases,
      project: row.project,
      persona: row.persona,
      number: row.number,
      cardNumber: row.card_number,
    };
  }

  /** The next value of a counter; it only goes up. */
  private next(project: string, scope: string): number {
    const row = this.db
      .query<{ last: number }, [string, string]>(
        `INSERT INTO session_name_counters (project, scope, last) VALUES (?, ?, 1)
         ON CONFLICT (project, scope) DO UPDATE SET last = last + 1 RETURNING last`,
      )
      .get(project, scope);
    return row?.last as number;
  }

  /** The counters of a project are kept by its slug: `Meu App` and `meu-app` count together. */
  private key(project: string): string {
    return slug(project) || NO_PROJECT;
  }

  /** The number of a card inside its project, given the first time the card is seen. */
  private cardNumber(project: string, cardId: string): number {
    const known = this.db
      .query<{ number: number }, [string]>(
        "SELECT number FROM session_card_numbers WHERE card_id = ?",
      )
      .get(cardId);
    if (known) return known.number;
    const number = this.next(this.key(project), CARDS);
    this.db
      .query("INSERT INTO session_card_numbers (card_id, number) VALUES (?, ?)")
      .run(cardId, number);
    return number;
  }

  /** The next sequence number: of the persona in the project, or of the persona on the card. */
  private number(project: string, persona: string, cardNumber: number | null): number {
    const personaKey = slug(persona) || GENERAL;
    const scope = cardNumber === null ? personaKey : `card:${cardNumber}:${personaKey}`;
    return this.next(this.key(project), scope);
  }

  /** Adds an alias unless another session has it. */
  private addAlias(id: string, alias: string): boolean {
    const taken = this.db
      .query<{ session_id: string }, [string]>(
        "SELECT session_id FROM session_aliases WHERE alias = ?",
      )
      .get(alias);
    if (taken) return taken.session_id === id;
    this.db.query("INSERT INTO session_aliases (alias, session_id) VALUES (?, ?)").run(alias, id);
    return true;
  }

  private insert(id: string, project: string, persona: string, cardNumber: number | null): void {
    // A number whose alias a rename already took is skipped: the counter only goes up.
    for (;;) {
      const number = this.number(project, persona, cardNumber);
      const parts = { project, persona, cardNumber, number };
      if (!this.addAlias(id, aliasName(parts))) continue;
      this.db
        .query(
          `INSERT INTO session_names (session_id, display, project, persona, number, card_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          displayName(parts),
          project,
          persona,
          number,
          cardNumber,
          new Date(this.now()).toISOString(),
        );
      return;
    }
  }
}
