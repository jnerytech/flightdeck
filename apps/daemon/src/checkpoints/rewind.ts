/**
 * Phase 12: "Voltar arquivos até aqui". A live managed session with the SDK's file checkpoint
 * rewinds through `rewindFiles`; anything else goes back to the turn's `before` snapshot: files
 * of the snapshot are restored and files created after it removed, only inside the repository and
 * never ignored ones. A `safety` snapshot of the current state is taken first, so it can be undone.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FlightdeckError } from "../errors.ts";
import type { RewindFilesResult } from "../runtime/types.ts";
import { whichOnPath } from "../which.ts";
import type { SnapshotRow, Snapshots } from "./snapshots.ts";

export interface RewindSessions {
  /** A turn is running (or waiting for a permission) in the session. */
  busy(claudeSessionId: string): boolean;
  /** The SDK's rewind for a live managed session; null when there is none. */
  rewindFiles(
    claudeSessionId: string,
    userMessageId: string,
    dryRun: boolean,
  ): Promise<RewindFilesResult | null>;
}

export interface RewindPreview {
  via: "sdk" | "snapshot";
  files: Array<{ path: string; change: string }>;
  insertions: number;
  deletions: number;
}

const CHANGES: Record<string, string> = { M: "modified", A: "created", D: "deleted" };

async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: Buffer }> {
  const proc = Bun.spawn([whichOnPath("git") ?? "git", ...args], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer().then((b) => Buffer.from(b)),
    proc.exited,
  ]);
  return { code, stdout };
}

export class Rewinder {
  constructor(private readonly opts: { snapshots: Snapshots; sessions: RewindSessions }) {}

  async preview(claudeSessionId: string, turn: number): Promise<RewindPreview> {
    const target = this.turn(claudeSessionId, turn);
    const sdk = await this.sdk(claudeSessionId, target, true);
    return sdk ?? (await this.snapshotDiff(target)).preview;
  }

  async apply(claudeSessionId: string, turn: number, confirm: boolean): Promise<RewindPreview> {
    this.allowed(claudeSessionId, confirm);
    const target = this.turn(claudeSessionId, turn);
    await this.safety(claudeSessionId, target.repo);
    const sdk = await this.sdk(claudeSessionId, target, false);
    return sdk ?? (await this.restore(target));
  }

  /** Goes back to the state saved before the last rewind. */
  async undo(claudeSessionId: string, confirm: boolean): Promise<RewindPreview> {
    this.allowed(claudeSessionId, confirm);
    const safety = this.opts.snapshots
      .list(claudeSessionId)
      .reverse()
      .find((s) => s.kind === "safety");
    if (!safety) throw new FlightdeckError("not_found", "nenhuma volta para desfazer nesta sessão");
    return this.restore(safety);
  }

  private allowed(claudeSessionId: string, confirm: boolean): void {
    if (!confirm) throw new FlightdeckError("invalid_state", "voltar arquivos pede confirm: true");
    if (this.opts.sessions.busy(claudeSessionId)) {
      throw new FlightdeckError("invalid_state", "a sessão está num turno: pare-a antes de voltar");
    }
  }

  private turn(claudeSessionId: string, n: number): SnapshotRow {
    const row = this.opts.snapshots
      .list(claudeSessionId)
      .find((s) => s.n === n && s.kind === "before");
    if (!row) throw new FlightdeckError("not_found", `turno ${n} sem snapshot nesta sessão`);
    return row;
  }

  private async safety(claudeSessionId: string, repo: string): Promise<void> {
    const result = await this.opts.snapshots.take({ cwd: repo, claudeSessionId, kind: "safety" });
    if ("skipped" in result) {
      throw new FlightdeckError("invalid_state", `sem snapshot de segurança: ${result.skipped}`);
    }
  }

  /** The SDK's own rewind, when the session is live and the turn's message id is known. */
  private async sdk(
    claudeSessionId: string,
    target: SnapshotRow,
    dryRun: boolean,
  ): Promise<RewindPreview | null> {
    if (!target.turnUuid) return null;
    const result = await this.opts.sessions.rewindFiles(claudeSessionId, target.turnUuid, dryRun);
    if (!result?.canRewind) return null;
    return {
      via: "sdk",
      files: (result.filesChanged ?? []).map((path) => ({ path, change: "modified" })),
      insertions: result.insertions ?? 0,
      deletions: result.deletions ?? 0,
    };
  }

  /** What differs between the target's tree and the working tree now (in a temporary snapshot tree). */
  private async snapshotDiff(target: SnapshotRow) {
    const current = await this.opts.snapshots.currentTree(target.repo);
    const names = (
      await git(target.repo, ["diff", "--name-status", "--no-renames", target.tree, current])
    ).stdout
      .toString()
      .trim();
    const files = names
      ? names.split("\n").map((line) => {
          const [status, path] = line.split("\t") as [string, string];
          // From the target's point of view: created after it, deleted after it, or changed.
          return { path, change: CHANGES[status] ?? "modified" };
        })
      : [];
    const numstat = (
      await git(target.repo, ["diff", "--numstat", "--no-renames", target.tree, current])
    ).stdout
      .toString()
      .trim();
    let insertions = 0;
    let deletions = 0;
    for (const line of numstat ? numstat.split("\n") : []) {
      const [added, removed] = line.split("\t");
      // Going back removes what was added after the target, and puts back what was removed.
      deletions += Number(added) || 0;
      insertions += Number(removed) || 0;
    }
    return { preview: { via: "snapshot" as const, files, insertions, deletions } };
  }

  private async restore(target: SnapshotRow): Promise<RewindPreview> {
    const { preview } = await this.snapshotDiff(target);
    for (const file of preview.files) {
      const path = join(target.repo, file.path);
      if (file.change === "created") {
        rmSync(path, { force: true });
        continue;
      }
      const blob = await git(target.repo, ["cat-file", "blob", `${target.tree}:${file.path}`]);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, blob.stdout);
    }
    return preview;
  }
}
