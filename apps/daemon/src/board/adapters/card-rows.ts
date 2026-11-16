import type { Database } from "bun:sqlite";
import type { UnblockWhen } from "@flightdeck/protocol";
import type { BoardColumn } from "../types.ts";

/** A card ready to be inserted; the JSON columns arrive as the text the table keeps. */
export interface NewCardRow {
  id: string;
  projectId: string;
  title: string;
  description: string;
  column: BoardColumn;
  position: number;
  issueRef: string | null;
  issueExternal: boolean;
  arenaOf: string | null;
  variant: string | null;
  unblockWhen: UnblockWhen;
  autoStart: string | null;
  at: string;
  sourceKey: string | null;
  specPath: string | null;
  pinnedDocs: string | null;
  startWorkflow: string | null;
  startPersona: string | null;
}

/** What an edit writes: the whole editable part of the row, already resolved against the card. */
export interface CardEditRow {
  title: string;
  description: string;
  estimateHours: number | null;
  validationNote: string | null;
  specPath: string | null;
  pinnedDocs: string | null;
  unblockWhen: UnblockWhen;
  autoStart: string | null;
  at: string;
}

/** The statements `cards.ts` runs on `cards` and `card_runs` (#1589). */
export class CardRows {
  constructor(private readonly db: Database) {}

  /** The finding key, column and last update of each card of the project that has a key. */
  sourceKeys(projectId: string) {
    return this.db
      .query<{ source_key: string; board_column: string; updated_at: string }, [string]>(
        `SELECT source_key, board_column, updated_at FROM cards
         WHERE project_id = ? AND source_key IS NOT NULL`,
      )
      .all(projectId);
  }

  /** The titles of the project's cards that are not done. */
  openTitles(projectId: string): string[] {
    return this.db
      .query<{ title: string }, [string]>(
        "SELECT title FROM cards WHERE project_id = ? AND board_column <> 'done'",
      )
      .all(projectId)
      .map((row) => row.title);
  }

  /** The last position of a column of the project; null when it holds no card. */
  lastPosition(projectId: string, column: BoardColumn): number | null {
    const { last } = this.db
      .query<{ last: number | null }, [string, string]>(
        "SELECT MAX(position) AS last FROM cards WHERE project_id = ? AND board_column = ?",
      )
      .get(projectId, column) ?? { last: null };
    return last;
  }

  insert(card: NewCardRow): void {
    this.db
      .query(
        `INSERT INTO cards (id, project_id, title, description, board_column, position, issue_ref,
           issue_external, arena_of, variant, unblock_when, auto_start, created_at, updated_at,
           source_key, spec_path, pinned_docs, start_workflow, start_persona)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        card.id,
        card.projectId,
        card.title,
        card.description,
        card.column,
        card.position,
        card.issueRef,
        card.issueExternal ? 1 : 0,
        card.arenaOf,
        card.variant,
        card.unblockWhen,
        card.autoStart,
        card.at,
        card.at,
        card.sourceKey,
        card.specPath,
        card.pinnedDocs,
        card.startWorkflow,
        card.startPersona,
      );
  }

  /** The card already made from an issue of the project, if any. */
  idForIssue(projectId: string, issueRef: string): string | null {
    const row = this.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM cards WHERE project_id = ? AND lower(issue_ref) = lower(?)",
      )
      .get(projectId, issueRef);
    return row?.id ?? null;
  }

  edit(id: string, edit: CardEditRow): void {
    this.db
      .query(
        `UPDATE cards SET title = ?, description = ?, estimate_hours = ?, validation_note = ?,
           spec_path = ?, pinned_docs = ?, unblock_when = ?, auto_start = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        edit.title,
        edit.description,
        edit.estimateHours,
        edit.validationNote,
        edit.specPath,
        edit.pinnedDocs,
        edit.unblockWhen,
        edit.autoStart,
        edit.at,
        id,
      );
  }

  /** What was found in the spec file belongs to the path it was found at: a new path forgets it. */
  forgetSpecFound(id: string): void {
    this.db
      .query(
        "UPDATE cards SET spec_checked_path = NULL, spec_found = 0, spec_heading = NULL, spec_draft = 0 WHERE id = ?",
      )
      .run(id);
  }

  insertRun(run: {
    id: string;
    cardId: string;
    at: string;
    persona: string | null;
    fixPrompt: string | null;
  }): void {
    this.db
      .query(
        "INSERT INTO card_runs (id, card_id, queued_at, persona, fix_prompt) VALUES (?, ?, ?, ?, ?)",
      )
      .run(run.id, run.cardId, run.at, run.persona, run.fixPrompt);
  }

  /** A new run has a new session, whose events start again: the loop's mark of the last one goes. */
  resetForRun(id: string): void {
    this.db
      .query(
        "UPDATE cards SET notice = NULL, unblocked_at = NULL, check_loop_turn_seq = NULL WHERE id = ?",
      )
      .run(id);
  }
}
