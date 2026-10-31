/**
 * Phase 26: the auto memory Claude Code keeps for a project (`~/.claude/projects/<project>/memory`):
 * the `MEMORY.md` index and one file per topic. Read, and edited only on an explicit action:
 * a write asks for confirm and for the hash of the content that was opened, stays inside the
 * memory folder, and leaves a record of the decision (never the content).
 */

export interface MemoryFile {
  name: string;
  /** sha256 of the file's bytes. */
  hash: string;
  bytes: number;
  lines: number;
  /** The `type` and `description` of the file's frontmatter, when it has them. */
  type?: string;
  description?: string;
  /** Whether `MEMORY.md` mentions the file (the index itself counts). */
  inIndex: boolean;
}

export interface MemoryListing {
  dir: string;
  exists: boolean;
  files: MemoryFile[];
}

export interface MemoryDecision {
  action: "write" | "delete";
  name: string;
  /** The hashes before and after; `null` where the file did not exist or no longer does. */
  before: string | null;
  after: string | null;
  at: string;
}

export interface MemoryWrite {
  name: string;
  content: string;
  /** The hash read when the file was opened; null creates a file that must not exist yet. */
  expectedHash: string | null;
  confirm: boolean;
}

export interface MemoryRemove {
  name: string;
  expectedHash: string;
  confirm: boolean;
}

export interface ProjectMemoryOptions {
  /** `~/.claude` unless told otherwise. */
  claudeDir?: string;
  clock?: () => number;
  /** Told of every write and delete that landed. */
  record?: (decision: MemoryDecision) => void;
}

export class ProjectMemory {
  constructor(private readonly opts: ProjectMemoryOptions = {}) {}

  /** The memory folder of the project the way Claude Code names it (all worktrees share one). */
  dir(_project: string): string {
    return "";
  }

  list(_project: string): MemoryListing {
    return { dir: "", exists: true, files: [] };
  }

  read(_project: string, _name: string): MemoryFile & { content: string } {
    return { name: "", hash: "", bytes: 0, lines: 0, inIndex: false, content: "" };
  }

  write(_project: string, _input: MemoryWrite): { hash: string } {
    return { hash: "" };
  }

  remove(_project: string, _input: MemoryRemove): void {}
}
