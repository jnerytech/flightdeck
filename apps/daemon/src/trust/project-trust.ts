/** Which projects may bring their own hooks, MCP servers and settings into a managed session (issue #196). */
import type { Database } from "bun:sqlite";

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
  now?: () => Date;
  log?: (line: string) => void;
}

export class ProjectTrust {
  constructor(
    private readonly db: Database,
    private readonly opts: ProjectTrustOptions = {},
  ) {
    void this.db;
    void this.opts;
  }

  isTrusted(_cwd: string): boolean {
    return true;
  }

  trust(_path: string, _source: TrustSource = "person"): void {}

  revoke(_path: string): void {}

  list(): TrustRecord[] {
    return [];
  }

  sessionTrust(_cwd: string): SessionTrust {
    return { trusted: true };
  }
}
