import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  BoardColumn,
  PrState,
  WorktreeBlocker,
  WorktreeItem,
  WorktreeRemoveResult,
  WorktreesResult,
} from "@flightdeck/protocol";
import type { CommandResult } from "../board/command.ts";
import { LOCAL_SETTINGS } from "../board/project-rules.ts";
import { samePath } from "../paths.ts";
import type { FolderLocks } from "./locks.ts";

export interface WorktreeProject {
  id: string;
  name: string;
  path: string;
  baseBranch: string;
}

export interface WorktreeCard {
  id: string;
  title: string;
  column: BoardColumn;
  worktreePath: string | null;
  updatedAt: string;
  prState: PrState | null;
}

export interface WorktreesOptions {
  projects(): WorktreeProject[];
  cards(projectId: string): WorktreeCard[];
  /** Whether anything runs in that folder: a live session, or a process of the card's run. */
  busy(path: string, cardId: string | null): "live_session" | "running" | null;
  /** The card (if any) no longer has this worktree, and no longer has its branch when `clearBranch`. */
  detach(cardId: string | null, path: string, clearBranch: boolean): void;
  git(repo: string, ...args: string[]): Promise<CommandResult>;
  /** Bytes under `path`; null when it could not be told in time. */
  size(path: string): Promise<number | null>;
  disk(path: string): Promise<{ totalBytes: number; freeBytes: number } | null>;
  now(): number;
  /** Folders being removed: nothing may start in one. */
  locks?: FolderLocks;
}

const DAY_MS = 86_400_000;
/** A worktree must have been quiet this long to be suggested. */
const IDLE_DAYS = 7;

/** The worktrees `git worktree list --porcelain` names: path and branch (short name), in order. */
function parseList(out: string): Array<{ path: string; branch: string | null }> {
  return out
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
      const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
      return path ? { path, branch: ref ? ref.replace(/^refs\/heads\//, "") : null } : null;
    })
    .filter((entry): entry is { path: string; branch: string | null } => entry !== null);
}

/** The branches Flightdeck makes; a worktree on any other branch is somebody else's work. */
const OWN_BRANCH = /^fd\//;

/** Ignored things that a build or an install rebuilds: losing them costs time, not work. */
const REBUILDABLE = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "__pycache__",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".gradle",
]);

/** The size an ignored file may have to be compared with the project's copy of it. */
const COMPARE_LIMIT = 1024 * 1024;

/** What one scan knows about a worktree: the item, and the tip of the branch the checks were made on. */
interface Scanned {
  item: WorktreeItem;
  branchSha: string | null;
  /** What the busy check threw: this one worktree is unknown, the others are still told. */
  fault: Error | null;
}

const COUNT = /^\d+$/;

/** What the cards leave on the disk: every `fd/*` worktree, how big, and whether it is safe to remove. */
export class Worktrees {
  constructor(private readonly opts: WorktreesOptions) {}

  private project(id: string): WorktreeProject | undefined {
    return this.opts.projects().find((p) => p.id === id);
  }

  /**
   * The commit the project's base branch names, as a hash, or null. Only a local or a remote
   * branch counts: a tag, `HEAD`, `@`, a relative name or an option is not a base, because
   * "not on the base" would then say nothing about the work being somewhere else.
   */
  private async baseSha(project: WorktreeProject): Promise<string | null> {
    const base = project.baseBranch;
    if (!base || base.startsWith("-")) return null;
    for (const ref of [`refs/heads/${base}`, `refs/remotes/${base}`]) {
      const out = await this.opts.git(
        project.path,
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      );
      const sha = out.stdout.trim();
      if (out.code === 0 && /^[0-9a-f]{40,64}$/.test(sha)) return sha;
    }
    return null;
  }

  /** Whether an ignored file is a copy of the project's own (what `.worktreeinclude` puts there). */
  private async sameAsProject(
    project: WorktreeProject,
    worktree: string,
    rel: string,
  ): Promise<boolean> {
    try {
      const mine = join(worktree, rel);
      const info = await lstat(mine);
      if (!info.isFile() || info.size > COMPARE_LIMIT) return false;
      const [a, b] = await Promise.all([readFile(mine), readFile(join(project.path, rel))]);
      return a.equals(b);
    } catch {
      return false;
    }
  }

  /** The ignored paths in `status` output that are not rebuildable and not a copy of the project's. */
  private async keepsIgnored(
    project: WorktreeProject,
    worktree: string,
    status: string,
  ): Promise<boolean> {
    for (const line of status.split("\n")) {
      if (!line.startsWith("!! ")) continue;
      const rel = line.slice(3).replace(/\/$/, "");
      const parts = rel.split("/");
      if (parts.some((part) => REBUILDABLE.has(part))) continue;
      if (rel === LOCAL_SETTINGS || rel.endsWith(".tsbuildinfo") || rel === ".DS_Store") continue;
      if (!line.endsWith("/") && (await this.sameAsProject(project, worktree, rel))) continue;
      return true;
    }
    return false;
  }

  /** The project's worktrees under `.flightdeck/worktrees`, with their facts; sizes when asked. */
  private async scan(project: WorktreeProject, withSize: boolean): Promise<Scanned[]> {
    const { git } = this.opts;
    const listed = await git(project.path, "worktree", "list", "--porcelain");
    if (listed.code !== 0) return [];
    let dir: string;
    try {
      dir = join(await realpath(project.path), ".flightdeck", "worktrees");
    } catch {
      return [];
    }
    const cards = this.opts.cards(project.id);
    const base = await this.baseSha(project);
    const mine: Array<{ path: string; branch: string | null; mtimeMs: number }> = [];
    for (const entry of parseList(listed.stdout)) {
      // Directly inside the worktrees folder, a real folder (not a link), nowhere else.
      if (resolve(entry.path, "..") !== resolve(dir)) continue;
      try {
        const info = await lstat(entry.path);
        if (info.isSymbolicLink()) continue;
        if (resolve(await realpath(entry.path), "..") !== resolve(await realpath(dir))) continue;
        mine.push({ ...entry, mtimeMs: info.mtimeMs });
      } catch {
        // Gone since git listed it: not ours to show.
      }
    }
    const now = this.opts.now();
    return Promise.all(
      mine.map(async (entry): Promise<Scanned> => {
        const card = cards.find((c) => c.worktreePath && samePath(c.worktreePath, entry.path));
        // The base is the branch itself: "not on the base" would be empty by construction.
        const baseUsable = base !== null && entry.branch !== project.baseBranch;
        const [status, ahead, last, tip, sizeBytes] = await Promise.all([
          // Untracked files shown whatever the user's config says; ignored ones listed as well.
          git(
            entry.path,
            "-c",
            "status.showUntrackedFiles=all",
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--ignored=matching",
          ),
          baseUsable
            ? git(entry.path, "rev-list", "--count", "HEAD", "--not", "--remotes", base)
            : Promise.resolve(null),
          git(entry.path, "log", "-1", "--format=%ct"),
          entry.branch
            ? git(
                project.path,
                "rev-parse",
                "--verify",
                "--quiet",
                `refs/heads/${entry.branch}^{commit}`,
              )
            : Promise.resolve(null),
          withSize ? this.opts.size(entry.path) : Promise.resolve(null),
        ]);
        // A status that fails is treated as dirty: when git cannot say, nothing is removed.
        const changed = status.stdout.split("\n").some((l) => l !== "" && !l.startsWith("!! "));
        const dirty = status.code !== 0 || changed;
        const ignoredFiles =
          status.code === 0 && (await this.keepsIgnored(project, entry.path, status.stdout));
        const count = ahead && ahead.code === 0 ? ahead.stdout.trim() : null;
        const stamp = last.code === 0 ? last.stdout.trim() : null;
        const tipSha = tip && tip.code === 0 ? tip.stdout.trim() : null;
        // Any answer that is not a plain number (or a failed command) is "git cannot say".
        const unknownState =
          (baseUsable && (count === null || !COUNT.test(count))) ||
          stamp === null ||
          !COUNT.test(stamp) ||
          (entry.branch !== null && !/^[0-9a-f]{40,64}$/.test(tipSha ?? ""));
        const unpushed = count !== null && COUNT.test(count) ? Number(count) : 0;
        const commitMs = stamp !== null && COUNT.test(stamp) ? Number(stamp) * 1000 : 0;
        const lastMs = Math.max(
          commitMs,
          entry.mtimeMs,
          card ? Date.parse(card.updatedAt) || 0 : 0,
        );
        let busy: ReturnType<WorktreesOptions["busy"]> = null;
        let fault: Error | null = null;
        try {
          busy = this.opts.busy(entry.path, card?.id ?? null);
        } catch (error) {
          fault = error instanceof Error ? error : new Error(String(error));
        }
        const blockers: WorktreeBlocker[] = [
          ...(busy ? [busy] : []),
          ...(dirty ? (["dirty"] as const) : []),
          ...(ignoredFiles ? (["ignored_files"] as const) : []),
          ...(unpushed > 0 ? (["unpushed"] as const) : []),
          ...(baseUsable ? [] : (["unknown_base"] as const)),
          ...(unknownState || fault ? (["unknown_state"] as const) : []),
          ...(entry.branch !== null && OWN_BRANCH.test(entry.branch)
            ? []
            : (["other_branch"] as const)),
        ];
        const idleDays = Math.max(0, (now - lastMs) / DAY_MS);
        const finished = !card || card.column === "done" || card.prState === "merged";
        return {
          branchSha: tipSha,
          fault,
          item: {
            projectId: project.id,
            projectName: project.name,
            path: entry.path,
            branch: entry.branch,
            cardId: card?.id ?? null,
            cardTitle: card?.title ?? null,
            column: card?.column ?? null,
            prState: card?.prState ?? null,
            dirty,
            unpushed,
            sizeBytes,
            lastActivity: new Date(lastMs).toISOString(),
            idleDays,
            blockers,
            suggested: blockers.length === 0 && finished && idleDays > IDLE_DAYS,
          },
        };
      }),
    );
  }

  async list(projectId?: string): Promise<WorktreesResult> {
    const projects = this.opts.projects().filter((p) => !projectId || p.id === projectId);
    const scans = await Promise.all(projects.map((p) => this.scan(p, true)));
    const disks = await Promise.all(
      projects.map(async (p) => {
        const disk = await this.opts.disk(p.path);
        return disk ? [{ projectId: p.id, ...disk }] : [];
      }),
    );
    return { worktrees: scans.flat().map((s) => s.item), disks: disks.flat() };
  }

  /**
   * Removes the worktrees that are still safe when this runs. Each folder is held (nothing may
   * start in it) while it is measured, looked at once more and removed; the last look is the one
   * that counts. Git itself refuses a dirty one (no `--force`), and the branch goes only if it
   * is still at the commit that was checked.
   */
  async remove(items: Array<{ projectId: string; path: string }>): Promise<WorktreeRemoveResult> {
    const removed: WorktreeRemoveResult["removed"] = [];
    const kept: WorktreeRemoveResult["kept"] = [];
    for (const item of items) {
      try {
        const outcome = await this.removeOne(item);
        if ("freedBytes" in outcome) removed.push(outcome);
        else kept.push(outcome);
      } catch (error) {
        kept.push({
          path: item.path,
          reason: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { removed, kept };
  }

  private async look(item: { projectId: string; path: string }): Promise<Scanned | undefined> {
    const project = this.project(item.projectId);
    if (!project) return undefined;
    return (await this.scan(project, false)).find((w) => samePath(w.item.path, item.path));
  }

  private async removeOne(item: {
    projectId: string;
    path: string;
  }): Promise<WorktreeRemoveResult["removed"][number] | WorktreeRemoveResult["kept"][number]> {
    const project = this.project(item.projectId);
    const first = await this.look(item);
    if (!project || !first) return { path: item.path, reason: "not_listed" };
    if (first.fault) throw first.fault;
    const firstBlocker = first.item.blockers[0];
    if (firstBlocker) return { path: item.path, reason: firstBlocker };
    // Another removal of the same folder is already at it.
    if (this.opts.locks?.isHeld(first.item.path)) return { path: item.path, reason: "running" };
    this.opts.locks?.hold(first.item.path);
    try {
      // The slow part first; the look that decides comes after it.
      const freedBytes = await this.opts.size(first.item.path);
      const last = await this.look(item);
      if (!last) return { path: item.path, reason: "not_listed" };
      if (last.fault) throw last.fault;
      const blocker = last.item.blockers[0];
      if (blocker) return { path: item.path, reason: blocker };
      const gone = await this.opts.git(
        project.path,
        "-c",
        "status.showUntrackedFiles=all",
        "worktree",
        "remove",
        last.item.path,
      );
      if (gone.code !== 0) return { path: item.path, reason: "failed", detail: gone.stderr.trim() };
      const branch = last.item.branch;
      let branchKept = false;
      if (branch && last.branchSha) {
        // Deletes the ref only if it still points where it was checked; a late commit keeps it.
        const deleted = await this.opts.git(
          project.path,
          "update-ref",
          "-d",
          `refs/heads/${branch}`,
          last.branchSha,
        );
        branchKept = deleted.code !== 0;
      }
      this.opts.detach(last.item.cardId, last.item.path, !branchKept);
      return { path: item.path, freedBytes, branchKept };
    } finally {
      this.opts.locks?.release(first.item.path);
    }
  }
}

/**
 * The size of a folder through `du -sk`, with a deadline. A scan that ran out of time, failed, or
 * answered something else is null: the list says "unknown", never 0.
 */
export async function duSize(
  path: string,
  timeoutMs: number,
  run: (cmd: string[], cwd: string, timeoutMs: number) => Promise<CommandResult>,
): Promise<number | null> {
  try {
    const out = await run(["du", "-sk", path], path, timeoutMs);
    if (out.timedOut || out.code !== 0) return null;
    const kilobytes = Number.parseInt(out.stdout.trim().split(/\s+/)[0] ?? "", 10);
    return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
  } catch {
    return null;
  }
}
