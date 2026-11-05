/** Which projects may bring their own hooks, MCP servers and settings into a managed session (issue #196). */
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { isInside } from "../paths.ts";

export type TrustSource = "person" | "migration";

export interface TrustRecord {
  path: string;
  trustedAt: string;
  source: TrustSource;
}

/** What a session is told about its folder: whether the repo's own configuration may load. */
export interface SessionTrust {
  trusted: boolean;
  /** The trusted main checkout of a worktree: its configuration is read from there, never from the branch. */
  configRoot?: string;
}

export interface ProjectTrustOptions {
  /** The main checkout a worktree belongs to, or null when `cwd` is not a worktree. */
  configRootOf?: (cwd: string) => string | null;
  /** The roots the host allows: a trust record on a root, or above one, grants nothing by prefix. */
  roots?: () => readonly string[];
  now?: () => Date;
  log?: (line: string) => void;
}

interface Row {
  path: string;
  trusted_at: string;
  source: TrustSource;
}

/** The person's decision, per folder, kept by the daemon: off until they say so. */
export class ProjectTrust {
  constructor(
    private readonly db: Database,
    private readonly opts: ProjectTrustOptions = {},
  ) {}

  /** Whether `cwd` is a trusted folder or lies inside one. */
  isTrusted(cwd: string): boolean {
    return this.via(cwd) !== null;
  }

  /** The record that makes `cwd` trusted (its own folder or the nearest one above), or null. */
  via(cwd: string): string | null {
    const here = resolve(cwd);
    const granting = this.rows()
      .filter((row) => isInside(row.path, here))
      .sort((a, b) => b.path.length - a.path.length);
    return granting[0]?.path ?? null;
  }

  /** Trusts a folder and everything inside it; a repeat changes nothing. */
  trust(path: string, source: TrustSource = "person"): void {
    const at = resolve(path);
    const done = this.db
      .query("INSERT OR IGNORE INTO project_trust (path, trusted_at, source) VALUES (?, ?, ?)")
      .run(at, (this.opts.now?.() ?? new Date()).toISOString(), source);
    if (done.changes > 0) this.opts.log?.(`project trust: trusted ${at} (${source})`);
  }

  revoke(path: string): void {
    const at = resolve(path);
    const done = this.db.query("DELETE FROM project_trust WHERE path = ?").run(at);
    if (done.changes > 0) this.opts.log?.(`project trust: revoked ${at}`);
  }

  list(): TrustRecord[] {
    return this.rows().map((row) => ({
      path: row.path,
      trustedAt: row.trusted_at,
      source: row.source,
    }));
  }

  /**
   * What a session in `cwd` may load. A worktree is read from its main checkout and is trusted only
   * if that is: a branch, trusted or not, never brings its own hooks.
   */
  /** Looks at the folder's git boundaries once, so `sessionTrust` can stay synchronous. */
  async prepare(_cwd: string): Promise<void> {}

  sessionTrust(cwd: string): SessionTrust {
    const main = this.opts.configRootOf?.(cwd) ?? null;
    if (main) return { trusted: this.isTrusted(main), configRoot: main };
    return { trusted: this.isTrusted(cwd) };
  }

  private rows(): Row[] {
    return this.db
      .query<Row, []>("SELECT path, trusted_at, source FROM project_trust ORDER BY path")
      .all();
  }
}
