import type { Database } from "bun:sqlite";

export interface Row {
  id: string;
  scope: "host" | "project";
  project_path: string | null;
  name: string;
  type: "command" | "prompt";
  body: string;
  vars: string;
  tags: string;
}

export interface Mark {
  id: string;
  favorite: number;
  uses: number;
  last_used_at: string | null;
}

/**
 * The SQLite side of the snippets (#1589): `snippets`, `snippet_marks` (favorite and use counts)
 * and `snippet_trust` (the hashes of a project's versioned file a person trusted). The store
 * decides what a snippet is and who may change it; this keeps what it decided.
 */
export class SnippetRows {
  constructor(private readonly db: Database) {}

  rows(scope: "host" | "project", project: string | null): Row[] {
    return this.db
      .query("SELECT * FROM snippets WHERE scope = ? AND project_path IS ?")
      .all(scope, project) as Row[];
  }

  row(id: string): Row | null {
    return this.db.query("SELECT * FROM snippets WHERE id = ?").get(id) as Row | null;
  }

  mark(id: string): Mark | null {
    return this.db.query("SELECT * FROM snippet_marks WHERE id = ?").get(id) as Mark | null;
  }

  save(row: {
    id: string;
    scope: "host" | "project";
    project: string | null;
    name: string;
    type: "command" | "prompt";
    body: string;
    vars: string;
    tags: string;
    at: string;
  }): void {
    this.db
      .query(
        `INSERT INTO snippets (id, scope, project_path, name, type, body, vars, tags, created_at, updated_at)
         VALUES ($id, $scope, $project, $name, $type, $body, $vars, $tags, $at, $at)
         ON CONFLICT (id) DO UPDATE SET name = $name, type = $type, body = $body, vars = $vars,
           tags = $tags, updated_at = $at`,
      )
      .run({
        $id: row.id,
        $scope: row.scope,
        $project: row.project,
        $name: row.name,
        $type: row.type,
        $body: row.body,
        $vars: row.vars,
        $tags: row.tags,
        $at: row.at,
      });
  }

  remove(id: string): void {
    this.db.query("DELETE FROM snippets WHERE id = ?").run(id);
  }

  removeMark(id: string): void {
    this.db.query("DELETE FROM snippet_marks WHERE id = ?").run(id);
  }

  /** A file snippet that was renamed keeps its favorite and its uses under the new id. */
  moveMark(from: string, to: string): void {
    this.db.query("UPDATE snippet_marks SET id = ? WHERE id = ?").run(to, from);
  }

  setFavorite(id: string, favorite: boolean): void {
    this.db
      .query(
        `INSERT INTO snippet_marks (id, favorite, uses, last_used_at) VALUES (?, ?, 0, NULL)
         ON CONFLICT (id) DO UPDATE SET favorite = excluded.favorite`,
      )
      .run(id, favorite ? 1 : 0);
  }

  countUse(id: string, at: string): void {
    this.db
      .query(
        `INSERT INTO snippet_marks (id, favorite, uses, last_used_at) VALUES (?, 0, 1, ?)
         ON CONFLICT (id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at`,
      )
      .run(id, at);
  }

  isTrusted(project: string, hash: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM snippet_trust WHERE project_path = ? AND hash = ?")
        .get(project, hash) !== null
    );
  }

  trust(project: string, hash: string, at: string): void {
    this.db
      .query(
        "INSERT OR IGNORE INTO snippet_trust (project_path, hash, trusted_at) VALUES (?, ?, ?)",
      )
      .run(project, hash, at);
  }
}
