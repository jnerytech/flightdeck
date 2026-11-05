import { lstat, realpath } from "node:fs/promises";
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
import { samePath } from "../paths.ts";

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
  /** The card no longer has this worktree. */
  detach(cardId: string): void;
  git(repo: string, ...args: string[]): Promise<CommandResult>;
  /** Bytes under `path`; null when it could not be told in time. */
  size(path: string): Promise<number | null>;
  disk(path: string): Promise<{ totalBytes: number; freeBytes: number } | null>;
  now(): number;
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

/** What the cards leave on the disk: every `fd/*` worktree, how big, and whether it is safe to remove. */
export class Worktrees {
  constructor(private readonly opts: WorktreesOptions) {}

  private project(id: string): WorktreeProject | undefined {
    return this.opts.projects().find((p) => p.id === id);
  }

  /** The project's worktrees under `.flightdeck/worktrees`, with their facts; sizes when asked. */
  private async scan(project: WorktreeProject, withSize: boolean): Promise<WorktreeItem[]> {
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
    const baseKnown =
      (await git(project.path, "rev-parse", "--verify", "--quiet", project.baseBranch)).code === 0;
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
      mine.map(async (entry): Promise<WorktreeItem> => {
        const card = cards.find((c) => c.worktreePath && samePath(c.worktreePath, entry.path));
        const [status, ahead, last, sizeBytes] = await Promise.all([
          git(entry.path, "status", "--porcelain"),
          baseKnown
            ? git(
                entry.path,
                "rev-list",
                "--count",
                "HEAD",
                "--not",
                "--remotes",
                project.baseBranch,
              )
            : Promise.resolve(null),
          git(entry.path, "log", "-1", "--format=%ct"),
          withSize ? this.opts.size(entry.path) : Promise.resolve(null),
        ]);
        // A status that fails is treated as dirty: when git cannot say, nothing is removed.
        const dirty = status.code !== 0 || status.stdout.trim() !== "";
        const unpushed = ahead && ahead.code === 0 ? Number(ahead.stdout.trim()) || 0 : 0;
        const commitMs = last.code === 0 ? Number(last.stdout.trim()) * 1000 || 0 : 0;
        const lastMs = Math.max(
          commitMs,
          entry.mtimeMs,
          card ? Date.parse(card.updatedAt) || 0 : 0,
        );
        const busy = this.opts.busy(entry.path, card?.id ?? null);
        const blockers: WorktreeBlocker[] = [
          ...(busy ? [busy] : []),
          ...(dirty ? (["dirty"] as const) : []),
          ...(unpushed > 0 ? (["unpushed"] as const) : []),
          ...(baseKnown ? [] : (["unknown_base"] as const)),
        ];
        const idleDays = Math.max(0, (now - lastMs) / DAY_MS);
        const finished = !card || card.column === "done" || card.prState === "merged";
        return {
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
    return { worktrees: scans.flat(), disks: disks.flat() };
  }

  /**
   * Removes the worktrees that are still safe when this runs: each is looked at again, must be
   * one the project lists, and goes without `--force`, so git itself refuses a dirty one.
   */
  async remove(items: Array<{ projectId: string; path: string }>): Promise<WorktreeRemoveResult> {
    const removed: WorktreeRemoveResult["removed"] = [];
    const kept: WorktreeRemoveResult["kept"] = [];
    for (const item of items) {
      const project = this.project(item.projectId);
      const found = project
        ? (await this.scan(project, false)).find((w) => samePath(w.path, item.path))
        : undefined;
      if (!project || !found) {
        kept.push({ path: item.path, reason: "not_listed" });
        continue;
      }
      const blocker = found.blockers[0];
      if (blocker) {
        kept.push({ path: item.path, reason: blocker });
        continue;
      }
      const freedBytes = await this.opts.size(found.path);
      const gone = await this.opts.git(project.path, "worktree", "remove", found.path);
      if (gone.code !== 0) {
        kept.push({ path: item.path, reason: "failed", detail: gone.stderr.trim() });
        continue;
      }
      // Nothing exists only on this branch (checked above), so the branch goes with it.
      if (found.branch) await this.opts.git(project.path, "branch", "-D", found.branch);
      if (found.cardId) this.opts.detach(found.cardId);
      removed.push({ path: item.path, freedBytes });
    }
    return { removed, kept };
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
