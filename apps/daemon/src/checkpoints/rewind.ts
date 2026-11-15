/**
 * Phase 12: "Voltar arquivos até aqui". A live managed session with the SDK's file checkpoint
 * rewinds through `rewindFiles`; anything else goes back to the turn's `before` snapshot: files
 * of the snapshot are restored and files created after it removed, only inside the repository and
 * never ignored ones. A `safety` snapshot of the current state is taken first, so it can be undone.
 */
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { gitBytes } from "../git/index.ts";
import { FlightdeckError } from "../kernel/index.ts";
import type { RewindFilesResult } from "../runtime/index.ts";
import { previewOf } from "./domain/rewind-preview.ts";
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
    if (!safety)
      throw new FlightdeckError("not_found", "no rewind to undo in this session", "rewind_nothing");
    return this.restore(safety);
  }

  private allowed(claudeSessionId: string, confirm: boolean): void {
    if (!confirm)
      throw new FlightdeckError(
        "invalid_state",
        "rewinding files needs confirm: true",
        "rewind_confirm",
      );
    if (this.opts.sessions.busy(claudeSessionId)) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is in a turn: stop it before rewinding",
        "rewind_turn_running",
      );
    }
  }

  private turn(claudeSessionId: string, n: number): SnapshotRow {
    const row = this.opts.snapshots
      .list(claudeSessionId)
      .find((s) => s.n === n && s.kind === "before");
    if (!row)
      throw new FlightdeckError(
        "not_found",
        `turn ${n} has no snapshot in this session`,
        "snapshot_missing",
        { n },
      );
    return row;
  }

  private async safety(claudeSessionId: string, repo: string): Promise<void> {
    const result = await this.opts.snapshots.take({ cwd: repo, claudeSessionId, kind: "safety" });
    if ("skipped" in result) {
      throw new FlightdeckError(
        "invalid_state",
        `no safety snapshot: ${result.skipped}`,
        "rewind_no_safety_snapshot",
        { why: result.skipped },
      );
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
      await gitBytes(target.repo, ["diff", "--name-status", "--no-renames", target.tree, current])
    ).stdout
      .toString()
      .trim();
    const numstat = (
      await gitBytes(target.repo, ["diff", "--numstat", "--no-renames", target.tree, current])
    ).stdout
      .toString()
      .trim();
    return { preview: { via: "snapshot" as const, ...previewOf(names, numstat) } };
  }

  /**
   * Puts back the files of the target. Everything is read and checked first, so a path that
   * runs through a link, or a blob that cannot be read, stops the rewind before it writes anything.
   */
  private async restore(target: SnapshotRow): Promise<RewindPreview> {
    const { preview } = await this.snapshotDiff(target);
    const plan: Array<{ rel: string; blob: Buffer | null }> = [];
    const refuseLink = async (rel: string, writing: boolean) => {
      if (!(await runsThroughLink(target.repo, rel, writing))) return;
      throw new FlightdeckError(
        "invalid_state",
        `${rel} is, or sits inside, a link: nothing was rewound`,
        "rewind_through_link",
        { path: rel },
      );
    };
    await inSequence(preview.files, async (file) => {
      const created = file.change === "created";
      await refuseLink(file.path, !created);
      if (created) {
        plan.push({ rel: file.path, blob: null });
        return;
      }
      const blob = await gitBytes(target.repo, ["cat-file", "blob", `${target.tree}:${file.path}`]);
      if (blob.code !== 0) {
        throw new FlightdeckError(
          "invalid_state",
          `${file.path} cannot be read from the snapshot: nothing was rewound`,
          "rewind_blob_unreadable",
          { path: file.path },
        );
      }
      plan.push({ rel: file.path, blob: blob.stdout });
    });
    await inSequence(plan, async ({ rel, blob }) => {
      // Again right before the write: something that ran since the first check may have added a link.
      await refuseLink(rel, blob !== null);
      const path = join(target.repo, rel);
      if (!blob) {
        await rm(path, { force: true });
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, blob);
    });
    return preview;
  }
}

/**
 * Whether touching `rel` in `repo` would leave it through a link: a folder on the way is one or,
 * when the file is written, the file is. Removing a link as the last step is fine: that takes only
 * the link.
 */
async function runsThroughLink(repo: string, rel: string, writing: boolean): Promise<boolean> {
  const parts = rel.split("/");
  let at = repo;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1 && !writing) return false;
    at = join(at, part);
    const info = await lstat(at).catch(() => null);
    if (!info) return false;
    if (info.isSymbolicLink()) return true;
  }
  return false;
}
