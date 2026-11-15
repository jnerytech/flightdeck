import type { Database } from "bun:sqlite";
import type { PersonaSubagentsMode } from "@flightdeck/protocol";

/**
 * The SQLite side of the personas (#1589): the host's own (`personas`), the hashes of a project's
 * versioned personas a person trusted (`persona_trust`), and what the project and card tables say
 * about a folder. The store decides what a persona is and who may use it; this keeps what it
 * decided.
 */
export class PersonaRows {
  constructor(private readonly db: Database) {}

  /** The host's saved personas, as their stored JSON, by id. */
  hostRows(): Array<{ id: string; data: string }> {
    return this.db.query("SELECT id, data FROM personas ORDER BY id").all() as Array<{
      id: string;
      data: string;
    }>;
  }

  saveHost(id: string, data: string, at: string): void {
    this.db
      .query(
        `INSERT INTO personas (id, data, created_at, updated_at) VALUES ($id, $data, $at, $at)
         ON CONFLICT (id) DO UPDATE SET data = $data, updated_at = $at`,
      )
      .run({ $id: id, $data: data, $at: at });
  }

  /** Returns how many rows it removed. */
  removeHost(id: string): number {
    return this.db.query("DELETE FROM personas WHERE id = ?").run(id).changes;
  }

  /** What the project of a folder (or of a card's worktree) offers as subagents; all by default. */
  subagentsMode(folder: string): PersonaSubagentsMode {
    const row = this.db
      .query(
        `SELECT persona_subagents AS mode FROM projects WHERE path = $folder
         UNION ALL
         SELECT p.persona_subagents FROM cards c JOIN projects p ON p.id = c.project_id
          WHERE c.worktree_path = $folder LIMIT 1`,
      )
      .get({ $folder: folder }) as { mode: PersonaSubagentsMode | null } | null;
    return row?.mode ?? "all";
  }

  /** The folder trust is kept under: a card's worktree answers for the project it was made from. */
  trustFolder(folder: string): string {
    const row = this.db
      .query(
        `SELECT p.path FROM cards c JOIN projects p ON p.id = c.project_id
         WHERE c.worktree_path = ?`,
      )
      .get(folder) as { path: string } | null;
    return row?.path ?? folder;
  }

  isTrusted(project: string, id: string, hash: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM persona_trust WHERE project_path = ? AND id = ? AND hash = ?")
        .get(this.trustFolder(project), id, hash) !== null
    );
  }

  trust(project: string, id: string, hash: string, at: string): void {
    this.db
      .query(
        "INSERT OR IGNORE INTO persona_trust (project_path, id, hash, trusted_at) VALUES (?, ?, ?, ?)",
      )
      .run(this.trustFolder(project), id, hash, at);
  }

  forgetTrust(project: string, id: string): void {
    this.db
      .query("DELETE FROM persona_trust WHERE project_path = ? AND id = ?")
      .run(this.trustFolder(project), id);
  }
}
