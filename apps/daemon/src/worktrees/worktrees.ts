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
import { credential } from "../permissions/sensitive-paths.ts";
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
      // Git writes `C:/x/y` on Windows: the path is the system's own spelling from here on.
      return path
        ? { path: resolve(path), branch: ref ? ref.replace(/^refs\/heads\//, "") : null }
        : null;
    })
    .filter((entry): entry is { path: string; branch: string | null } => entry !== null);
}

/** The branches Flightdeck makes; a worktree on any other branch is somebody else's work. */
const OWN_BRANCH = /^fd\//;

/**
 * What a build or an install recreates, and only as a folder at the root of the worktree: losing
 * these costs time, not work. The same name deeper is somebody's data (`data/out/results.db`).
 */
const REBUILDABLE = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".cache",
  ".next",
  "out",
]);

/**
 * A name that looks like it holds a credential: such a file is never a loss to shrug at. The names
 * the classifier knows come from its one list (`credential()`); this adds the ones a name only
 * hints at.
 */
const CREDENTIAL_HINT = /credential|secret|token|passw(?:or)?d|api[_-]?key/i;
const credentialName = (part: string) => credential(part) || CREDENTIAL_HINT.test(part);

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
const SHA = /^[0-9a-f]{40,64}$/;

type Listed = { path: string; branch: string | null };
type Owned = Listed & { mtimeMs: number };

/** The worktree when it sits directly inside `dir` as a real folder (not a link); null otherwise. */
async function owned(entry: Listed, dir: string): Promise<Owned | null> {
  if (resolve(entry.path, "..") !== resolve(dir)) return null;
  try {
    const info = await lstat(entry.path);
    if (info.isSymbolicLink()) return null;
    if (resolve(await realpath(entry.path), "..") !== resolve(await realpath(dir))) return null;
    return { ...entry, mtimeMs: info.mtimeMs };
  } catch {
    // Gone since git listed it: not ours to show.
    return null;
  }
}

/** The trimmed output of a git answer that succeeded; null when it failed or was not asked. */
const okOut = (answer: CommandResult | null): string | null =>
  answer?.code === 0 ? answer.stdout.trim() : null;

/** Whether git printed a plain number (a count, a unix time). */
const isCount = (text: string | null): text is string => text !== null && COUNT.test(text);

/**
 * Whether `git ls-files -v -z` shows a tracked file that status hides: `assume-unchanged` (a
 * lowercase tag) or `skip-worktree` (`S`).
 */
function hidesChanges(listing: CommandResult): boolean {
  return (
    listing.code === 0 &&
    listing.stdout.split("\0").some((entry) => entry !== "" && /^[a-z]|^S/.test(entry))
  );
}

/** Any answer of git that is not a plain number (or a failed command) is "git cannot say". */
function cannotTell(facts: {
  baseUsable: boolean;
  count: string | null;
  listingFailed: boolean;
  stamp: string | null;
  branch: string | null;
  tipSha: string | null;
}): boolean {
  return (
    (facts.baseUsable && !isCount(facts.count)) ||
    facts.listingFailed ||
    !isCount(facts.stamp) ||
    (facts.branch !== null && !SHA.test(facts.tipSha ?? ""))
  );
}

/** What stops a removal, in the order the app shows it. */
function blockersOf(facts: {
  busy: ReturnType<WorktreesOptions["busy"]>;
  dirty: boolean;
  hidden: boolean;
  ignoredFiles: boolean;
  unpushed: number;
  baseUsable: boolean;
  unknownState: boolean;
  branch: string | null;
}): WorktreeBlocker[] {
  const flags: Array<[boolean, WorktreeBlocker]> = [
    [facts.dirty, "dirty"],
    [facts.hidden, "hidden_changes"],
    [facts.ignoredFiles, "ignored_files"],
    [facts.unpushed > 0, "unpushed"],
    [!facts.baseUsable, "unknown_base"],
    [facts.unknownState, "unknown_state"],
    [facts.branch === null || !OWN_BRANCH.test(facts.branch), "other_branch"],
  ];
  return [
    ...(facts.busy ? [facts.busy] : []),
    ...flags.filter(([on]) => on).map(([, blocker]) => blocker),
  ];
}

/** The latest of the last commit, the folder's own mtime and the card's last change. */
function lastActivityMs(stamp: string | null, mtimeMs: number, card?: WorktreeCard): number {
  const commitMs = isCount(stamp) ? Number(stamp) * 1000 : 0;
  return Math.max(commitMs, mtimeMs, card ? Date.parse(card.updatedAt) || 0 : 0);
}

/** The card's fields an item shows; null where the worktree has no card. */
function cardFields(card?: WorktreeCard) {
  return {
    cardId: card?.id ?? null,
    cardTitle: card?.title ?? null,
    column: card?.column ?? null,
    prState: card?.prState ?? null,
  };
}

/** Without a card, or with its work done or merged, nothing is left to lose in the folder. */
const finishedCard = (card?: WorktreeCard): boolean =>
  !card || card.column === "done" || card.prState === "merged";

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
      // git-arg: both refs start with "refs/", and the base was checked not to start with "-" above
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

  /** Whether `status` lists an ignored path that goes with the folder and cannot be shrugged at. */
  private async keepsIgnored(
    project: WorktreeProject,
    worktree: string,
    status: string,
  ): Promise<boolean> {
    for (const line of status.split("\n")) {
      if (!line.startsWith("!! ")) continue;
      const listed = line.slice(3);
      const folder = listed.endsWith("/");
      const rel = folder ? listed.slice(0, -1) : listed;
      // Flightdeck's own file, written into every worktree (a credential for reads, no loss here).
      if (rel === LOCAL_SETTINGS) continue;
      // A credential-looking name at any depth: never.
      if (credential(rel) || rel.split("/").some(credentialName)) return true;
      // A rebuildable folder, at the root.
      if (folder && !rel.includes("/") && REBUILDABLE.has(rel)) continue;
      // A copy of the project's own ignored file (what `.worktreeinclude` puts there), unedited.
      if (!folder && (await this.sameAsProject(project, worktree, rel))) continue;
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
    const mine = (await Promise.all(parseList(listed.stdout).map((entry) => owned(entry, dir))))
      // Directly inside the worktrees folder, a real folder (not a link), nowhere else.
      .filter((entry): entry is Owned => entry !== null);
    const now = this.opts.now();
    return Promise.all(
      mine.map((entry) =>
        this.scanOne(project, entry, {
          base,
          withSize,
          now,
          card: cards.find((c) => c.worktreePath && samePath(c.worktreePath, entry.path)),
        }),
      ),
    );
  }

  /** The tip of the branch, as a hash; null without a branch or when git cannot name it. */
  private async branchTip(project: WorktreeProject, branch: string | null): Promise<string | null> {
    if (!branch) return null;
    return okOut(
      await this.opts.git(
        project.path,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}^{commit}`,
      ),
    );
  }

  /** How many commits of the branch are on no remote and not on the base; null when not asked. */
  private unpushedCommits(
    path: string,
    branch: string | null,
    tipSha: string | null,
    base: string | null,
  ): Promise<CommandResult | null> {
    // Without a branch the work is the checkout's HEAD; with one, it must have a tip to count on.
    if (base === null || (branch !== null && tipSha === null)) return Promise.resolve(null);
    // git-arg: tipSha and base are commit ids git printed (baseSha resolves the project base to one)
    return this.opts.git(path, "rev-list", "--count", tipSha ?? "HEAD", "--not", "--remotes", base);
  }

  /** Whether anything runs in the folder; a check that throws makes this one worktree unknown. */
  private busyOf(path: string, cardId: string | null) {
    try {
      return { busy: this.opts.busy(path, cardId), fault: null };
    } catch (error) {
      return { busy: null, fault: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /** One worktree's facts and what stops its removal. */
  private async scanOne(
    project: WorktreeProject,
    entry: Owned,
    ctx: { base: string | null; withSize: boolean; now: number; card?: WorktreeCard },
  ): Promise<Scanned> {
    const { git } = this.opts;
    const { card } = ctx;
    // The base is the branch itself: "not on the base" would be empty by construction.
    const base = entry.branch === project.baseBranch ? null : ctx.base;
    // The branch tip first: the commits are counted on it, so the count and the sha that the
    // branch is deleted against are one snapshot.
    const tipSha = await this.branchTip(project, entry.branch);
    const [status, listing, ahead, last, sizeBytes] = await Promise.all([
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
      // The tag of each tracked file: what `assume-unchanged` or `skip-worktree` hides from status.
      git(entry.path, "ls-files", "-v", "-z"),
      this.unpushedCommits(entry.path, entry.branch, tipSha, base),
      git(entry.path, "log", "-1", "--format=%ct"),
      ctx.withSize ? this.opts.size(entry.path) : Promise.resolve(null),
    ]);
    // A status that fails is treated as dirty: when git cannot say, nothing is removed.
    const dirty =
      status.code !== 0 || status.stdout.split("\n").some((l) => l !== "" && !l.startsWith("!! "));
    const ignoredFiles =
      status.code === 0 && (await this.keepsIgnored(project, entry.path, status.stdout));
    const count = okOut(ahead);
    const stamp = okOut(last);
    const { busy, fault } = this.busyOf(entry.path, card?.id ?? null);
    const unpushed = isCount(count) ? Number(count) : 0;
    const baseUsable = base !== null;
    const blockers = blockersOf({
      busy,
      dirty,
      hidden: hidesChanges(listing),
      ignoredFiles,
      unpushed,
      baseUsable,
      unknownState:
        fault !== null ||
        cannotTell({
          baseUsable,
          count,
          listingFailed: listing.code !== 0,
          stamp,
          branch: entry.branch,
          tipSha,
        }),
      branch: entry.branch,
    });
    const lastMs = lastActivityMs(stamp, entry.mtimeMs, card);
    const idleDays = Math.max(0, (ctx.now - lastMs) / DAY_MS);
    return {
      branchSha: tipSha,
      fault,
      item: {
        projectId: project.id,
        projectName: project.name,
        path: entry.path,
        branch: entry.branch,
        ...cardFields(card),
        dirty,
        unpushed,
        sizeBytes,
        lastActivity: new Date(lastMs).toISOString(),
        idleDays,
        blockers,
        suggested: blockers.length === 0 && finishedCard(card) && idleDays > IDLE_DAYS,
      },
    };
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
        const outcome = await this.removeOne(item); // NOSONAR: one folder at a time, each re-checked right before git removes it
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
        // git-arg: the ref is prefixed with "refs/heads/", and branchSha is a commit id git printed
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
