/** Which projects may bring their own hooks, MCP servers and settings into a managed session (issue #196). */
import type { Database } from "bun:sqlite";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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
  /** Reads a `.git` file (a test seam: a file that cannot be read is a boundary, not a crash). */
  readText?: (path: string) => Promise<string>;
}

interface Row {
  path: string;
  trusted_at: string;
  source: TrustSource;
  scope: "tree" | "exact";
}

/** Where a card's worktree is made: inside the repo, in a folder this name gives away. */
const WORKTREE_AREAS = [
  `${sep}.flightdeck${sep}worktrees${sep}`,
  `${sep}.claude${sep}worktrees${sep}`,
];

/** The repo a path of a worktree area belongs to (what comes before the area), or null. */
function repoOfWorktreeArea(path: string): string | null {
  const here = `${resolve(path)}${sep}`;
  const found = WORKTREE_AREAS.map((area) => here.indexOf(area)).filter((at) => at >= 0);
  return found.length > 0 ? here.slice(0, Math.min(...found)) || sep : null;
}

/** What a folder's git boundary says: the main checkout of a worktree, or none for a nested clone. */
interface Boundary {
  main: string | null;
}

/** The person's decision, per folder, kept by the daemon: off until they say so. */
export class ProjectTrust {
  private readonly boundaries = new Map<string, Boundary>();

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
    const roots = (this.opts.roots?.() ?? []).map((root) => resolve(root));
    const granting = this.rows()
      .filter((row) => {
        if (row.scope === "exact") return resolve(row.path) === here;
        // A root, or a folder that holds one, would trust every clone made inside it.
        if (roots.some((root) => isInside(row.path, root))) return false;
        return isInside(row.path, here);
      })
      .sort((a, b) => b.path.length - a.path.length);
    return granting[0]?.path ?? null;
  }

  /** Trusts a folder and everything inside it; a repeat changes nothing. */
  trust(path: string, source: TrustSource = "person", scope: "tree" | "exact" = "tree"): void {
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
  /**
   * Looks at the git boundaries between `cwd` and the record that covers it, once, so `sessionTrust`
   * stays synchronous. A `.git` directory below the record is a nested clone (not covered); a `.git`
   * file is a worktree or a submodule, and a worktree is read from its main checkout.
   */
  async prepare(cwd: string): Promise<void> {
    const here = resolve(cwd);
    this.boundaries.delete(here);
    const via = this.via(here);
    if (via === null) return;
    const top = resolve(via);
    for (let dir = here; dir !== top && isInside(top, dir); dir = dirname(dir)) {
      const git = join(dir, ".git");
      const info = await stat(git).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) {
        this.boundaries.set(here, { main: null });
        return;
      }
      const text = await (this.opts.readText ?? ((path) => readFile(path, "utf8")))(git).catch(
        () => "",
      );
      const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim();
      const main = gitdir ? this.mainOfGitdir(gitdir, dir) : null;
      this.boundaries.set(here, { main });
      return;
    }
  }

  /** `<main>/.git/worktrees/<name>` names its main checkout; a submodule's gitdir does not. */
  private mainOfGitdir(gitdir: string, from: string): string | null {
    const dir = resolve(from, gitdir);
    const marker = `${sep}.git${sep}worktrees${sep}`;
    const at = `${dir}${sep}`.indexOf(marker);
    return at > 0 ? dir.slice(0, at) : null;
  }

  sessionTrust(cwd: string): SessionTrust {
    const main = this.opts.configRootOf?.(cwd) ?? repoOfWorktreeArea(cwd);
    if (main) return { trusted: this.isTrusted(main), configRoot: main };
    const boundary = this.boundaries.get(resolve(cwd));
    if (boundary?.main)
      return { trusted: this.isTrusted(boundary.main), configRoot: boundary.main };
    if (boundary) return { trusted: false };
    return { trusted: this.isTrusted(cwd) };
  }

  private rows(): Row[] {
    return this.db
      .query<Row, []>("SELECT path, trusted_at, source, scope FROM project_trust ORDER BY path")
      .all();
  }
}
