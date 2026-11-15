import type { Database } from "bun:sqlite";
import type { TeamRow } from "../domain/stored.ts";

/** The columns a team changes after it is created, apart from its report. */
type TeamPatchColumns = Partial<
  Record<"state" | "paused_by" | "members" | "goal" | "checks", string | null>
>;

/**
 * The SQLite side of the teams (#1589): the `teams` rows. `Teams` decides what a team may do and
 * when; this reads and writes the rows it decided on. Every time is an ISO string the caller read
 * from its own clock.
 */
export class TeamStore {
  constructor(private readonly db: Database) {}

  get(id: string): TeamRow | null {
    return this.db.query("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | null;
  }

  /** The project's teams (every project's when none is given), newest first. */
  list(projectId: string | null): TeamRow[] {
    return this.db
      .query(
        "SELECT * FROM teams WHERE (?1 IS NULL OR project_id = ?1) ORDER BY created_at DESC, rowid DESC",
      )
      .all(projectId) as TeamRow[];
  }

  /** The teams that are not closed. */
  notClosed(): TeamRow[] {
    return this.db.query("SELECT * FROM teams WHERE state <> 'closed'").all() as TeamRow[];
  }

  all(): TeamRow[] {
    return this.db.query("SELECT * FROM teams").all() as TeamRow[];
  }

  /** Just what the quota needs to pause or resume a team. */
  states(): Array<Pick<TeamRow, "id" | "state" | "paused_by">> {
    return this.db.query("SELECT id, state, paused_by FROM teams").all() as Array<
      Pick<TeamRow, "id" | "state" | "paused_by">
    >;
  }

  /** A new team, active and not paused by anyone. */
  insert(team: {
    id: string;
    name: string;
    projectId: string;
    goal: string;
    coordinator: string;
    members: string;
    checks: string;
    instructionsVersion: string;
    createdAt: string;
  }): void {
    this.db
      .query(
        `INSERT INTO teams (id, name, project_id, goal, coordinator, members, checks, state,
                            paused_by, instructions_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
      )
      .run(
        team.id,
        team.name,
        team.projectId,
        team.goal,
        team.coordinator,
        team.members,
        team.checks,
        team.instructionsVersion,
        team.createdAt,
      );
  }

  /** The coordinator's report; `done` says the goal is met. */
  report(id: string, text: string, at: string, done: boolean): void {
    this.db
      .query("UPDATE teams SET report_text = ?, report_at = ?, report_done = ? WHERE id = ?")
      .run(text, at, done ? 1 : 0, id);
  }

  /** One column at a time, in the order of the patch. */
  update(id: string, patch: TeamPatchColumns): void {
    for (const [column, value] of Object.entries(patch)) {
      this.db.query(`UPDATE teams SET ${column} = ? WHERE id = ?`).run(value ?? null, id);
    }
  }

  delete(id: string): void {
    this.db.query("DELETE FROM teams WHERE id = ?").run(id);
  }
}
