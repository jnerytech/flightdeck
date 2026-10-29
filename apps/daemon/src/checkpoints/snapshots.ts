/**
 * Phase 12: a git snapshot of the working tree at the start and end of each turn, without
 * touching the user's index or files. A temporary index (GIT_INDEX_FILE) takes HEAD plus every
 * change, untracked files included and ignored ones left out; the tree becomes a commit that
 * only `refs/flightdeck/snapshots/<session>/<n>` points to.
 */
import type { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whichOnPath } from "../which.ts";

export interface SnapshotRow {
  claudeSessionId: string;
  n: number;
  ref: string;
  tree: string;
  /** `before` and `after` a turn, or `safety` (taken before a rewind, to undo it). */
  kind: string;
  /** Uuid of the user's message in the transcript, when known. */
  turnUuid: string | null;
  prompt: string | null;
  createdAt: string;
  /** Top of the repository the ref lives in. */
  repo: string;
}

export interface SnapshotInput {
  cwd: string;
  claudeSessionId: string;
  kind: "before" | "after" | "safety";
  prompt?: string;
  turnUuid?: string;
}

/**
 * The snapshot a terminal session's hook asks for: before the turn on UserPromptSubmit (with
 * the prompt), after it on Stop; nothing for the other hooks or without a cwd.
 */
export function snapshotForHook(
  event: string,
  payload: { session_id?: unknown; cwd?: unknown; prompt?: unknown },
): SnapshotInput | null {
  const kind = event === "UserPromptSubmit" ? "before" : event === "Stop" ? "after" : null;
  if (!kind || typeof payload.cwd !== "string" || typeof payload.session_id !== "string") {
    return null;
  }
  return {
    cwd: payload.cwd,
    claudeSessionId: payload.session_id,
    kind,
    ...(typeof payload.prompt === "string" ? { prompt: payload.prompt } : {}),
  };
}

export type SnapshotResult = { row: SnapshotRow } | { skipped: string };

export interface SnapshotsOptions {
  db: Database;
  now?: () => number;
  /** Changes larger than this are not snapshotted (200 MB by default). */
  maxBytes?: number;
}

/** The snapshot commits need an author, whatever the user's git config says. */
const IDENTITY = {
  GIT_AUTHOR_NAME: "Flightdeck",
  GIT_AUTHOR_EMAIL: "flightdeck@localhost",
  GIT_COMMITTER_NAME: "Flightdeck",
  GIT_COMMITTER_EMAIL: "flightdeck@localhost",
};

interface Row {
  claude_session_id: string;
  n: number;
  ref: string;
  tree: string;
  kind: string;
  turn_uuid: string | null;
  prompt: string | null;
  created_at: string;
  repo: string;
}

const toRow = (r: Row): SnapshotRow => ({
  claudeSessionId: r.claude_session_id,
  n: r.n,
  ref: r.ref,
  tree: r.tree,
  kind: r.kind,
  turnUuid: r.turn_uuid,
  prompt: r.prompt,
  createdAt: r.created_at,
  repo: r.repo,
});

async function git(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn([whichOnPath("git") ?? "git", ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout: stdout.trim() };
}

async function must(cwd: string, args: string[], env: Record<string, string> = {}) {
  const result = await git(cwd, args, env);
  if (result.code !== 0) throw new Error(`git ${args[0]} falhou (${result.code})`);
  return result.stdout;
}

export class Snapshots {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly opts: SnapshotsOptions) {
    this.now = opts.now ?? Date.now;
  }

  async take(input: SnapshotInput): Promise<SnapshotResult> {
    const top = await git(input.cwd, ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) return { skipped: "fora de um repositório git" };
    const repo = top.stdout;
    const limit = this.opts.maxBytes ?? 200 * 1024 * 1024;
    if ((await this.changedBytes(repo)) > limit) {
      return { skipped: `mudanças acima do limite de ${limit} bytes` };
    }
    const tree = await this.writeTree(repo);
    const last = this.last(input.claudeSessionId);
    const n = (last?.n ?? 0) + 1;
    let ref = last?.ref ?? "";
    if (last?.tree !== tree) {
      const parent = await git(repo, ["rev-parse", "--verify", "-q", "HEAD"]);
      const message = `flightdeck snapshot ${input.claudeSessionId} ${n}`;
      const commit = await must(
        repo,
        ["commit-tree", tree, ...(parent.code === 0 ? ["-p", parent.stdout] : []), "-m", message],
        IDENTITY,
      );
      ref = `refs/flightdeck/snapshots/${input.claudeSessionId}/${n}`;
      await must(repo, ["update-ref", ref, commit]);
    }
    const row: SnapshotRow = {
      claudeSessionId: input.claudeSessionId,
      n,
      ref,
      tree,
      kind: input.kind,
      turnUuid: input.turnUuid ?? null,
      prompt: input.prompt ?? null,
      createdAt: new Date(this.now()).toISOString(),
      repo,
    };
    this.opts.db
      .query(
        `INSERT INTO snapshots (claude_session_id, n, ref, tree, kind, turn_uuid, prompt, created_at, repo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.claudeSessionId,
        n,
        ref,
        tree,
        row.kind,
        row.turnUuid,
        row.prompt,
        row.createdAt,
        repo,
      );
    return { row };
  }

  /** Queues a snapshot and returns at once; snapshots run one at a time, failures are dropped. */
  enqueue(input: SnapshotInput): void {
    this.queue = this.queue.then(() => this.take(input)).catch(() => {});
  }

  /** Resolves once everything queued so far is done. */
  async idle(): Promise<void> {
    await this.queue;
  }

  list(claudeSessionId: string): SnapshotRow[] {
    return (
      this.opts.db
        .query("SELECT * FROM snapshots WHERE claude_session_id = ? ORDER BY n")
        .all(claudeSessionId) as Row[]
    ).map(toRow);
  }

  /**
   * Keeps the newest `perSession` snapshots of each session and nothing older than `days`;
   * deletes the refs no remaining row points to. Returns how many rows went.
   */
  async prune(policy: { perSession: number; days: number }): Promise<number> {
    const cutoff = new Date(this.now() - policy.days * 86_400_000).toISOString();
    const rows = (
      this.opts.db
        .query("SELECT * FROM snapshots ORDER BY claude_session_id, n DESC")
        .all() as Row[]
    ).map(toRow);
    const seen = new Map<string, number>();
    const gone = rows.filter((row) => {
      const rank = (seen.get(row.claudeSessionId) ?? 0) + 1;
      seen.set(row.claudeSessionId, rank);
      return rank > policy.perSession || row.createdAt < cutoff;
    });
    for (const row of gone) {
      this.opts.db
        .query("DELETE FROM snapshots WHERE claude_session_id = ? AND n = ?")
        .run(row.claudeSessionId, row.n);
    }
    const kept = new Set(
      (this.opts.db.query("SELECT ref FROM snapshots").all() as Array<{ ref: string }>).map(
        (r) => r.ref,
      ),
    );
    for (const row of gone) {
      if (!kept.has(row.ref) && existsSync(row.repo)) {
        await git(row.repo, ["update-ref", "-d", row.ref]);
      }
    }
    return gone.length;
  }

  private last(claudeSessionId: string): SnapshotRow | null {
    const row = this.opts.db
      .query("SELECT * FROM snapshots WHERE claude_session_id = ? ORDER BY n DESC LIMIT 1")
      .get(claudeSessionId) as Row | null;
    return row ? toRow(row) : null;
  }

  /** Size of what changed against HEAD, untracked files included (status without index refresh). */
  private async changedBytes(repo: string): Promise<number> {
    const status = await must(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      GIT_OPTIONAL_LOCKS: "0",
    });
    let total = 0;
    for (const entry of status.split("\0")) {
      const path = join(repo, entry.slice(3));
      if (entry.length > 3 && existsSync(path)) total += statSync(path).size;
    }
    return total;
  }

  /** HEAD plus every change, in a temporary index the user never sees. */
  private async writeTree(repo: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "fd-snapshot-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    try {
      const head = await git(repo, ["rev-parse", "--verify", "-q", "HEAD"]);
      if (head.code === 0) await must(repo, ["read-tree", "HEAD"], env);
      await must(repo, ["add", "-A"], env);
      return await must(repo, ["write-tree"], env);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
