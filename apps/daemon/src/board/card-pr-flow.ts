import type { Database } from "bun:sqlite";
import { FlightdeckError } from "../errors.ts";
import { closingLine, parseIssueRef, providerOfRef } from "../issues/providers.ts";
import type { BoardEvent } from "./columns.ts";
import { git } from "./command.ts";
import { cardDiff } from "./diff.ts";
import {
  aheadBehind,
  assertLocalBranch,
  mergeIntoBase,
  pendingFiles,
  rebaseOnto,
} from "./merge.ts";
import { type PrComment, prMessage, prProvider } from "./pr.ts";
import { assertNoSecretInPr, publishPr } from "./publish-pr.ts";
import { assertBranchName, refArg } from "./ref-arg.ts";
import type { BoardOptions, Card, CardDiff, Project } from "./types.ts";

/** A card's session in one of these is still working: no rebase or merge under it. */
const BUSY: ReadonlySet<string> = new Set(["starting", "running", "awaiting_permission"]);

/** What a card's PR flow needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface CardPrFlowPort {
  db: Database;
  opts: Pick<BoardOptions, "prProvider" | "scanner">;
  card: (id: string) => Card;
  project: (id: string) => Project;
  changed: (id: string) => Card;
  place: (id: string, event: BoardEvent) => void;
  setNotice: (id: string, notice: string, why?: unknown) => void;
  stopped: () => boolean;
  message: (id: string, text: string) => unknown;
  /** Waits for the board's writes in flight before a worktree goes. */
  settle: () => Promise<void>;
  closeRuns: (id: string) => Promise<void>;
  /** The check loop, when one runs (issue #1361): only its stop, so this file needs nothing else of it. */
  loop: () => { onStop(cardId: string): Promise<unknown> } | null;
  /** The PR polling (`PrPoll`): started once a PR is open, read again after a merge. */
  armPoll: () => void;
  readInFlight: (id: string) => Promise<void> | undefined;
  pollPr: (id: string) => Promise<void>;
}

/**
 * Issue #1523: a card's way out through git: its diff, opening and merging its PR, the PR's review
 * comments and their cache, rebasing on the base, and the local merge of a card without a PR.
 */
export class CardPrFlow {
  /** Review comments of each card's open PR, from the last poll (phase 11). */
  private readonly commentCache = new Map<string, PrComment[]>();

  constructor(private readonly port: CardPrFlowPort) {}

  /** Commits since the base plus uncommitted changes, per file. */
  async diff(id: string): Promise<CardDiff> {
    const card = this.port.card(id);
    if (!card.worktreePath)
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    return cardDiff(card.worktreePath, refArg(this.port.project(card.projectId).baseBranch));
  }

  /**
   * Pushes the card's branch to `origin` and opens the PR with the card's title and description;
   * `description` (phase 22) is the text the person confirmed, instead of the card's own.
   */
  async createPr(
    id: string,
    options: { description?: string; title?: string } = {},
  ): Promise<Card> {
    const card = this.port.card(id);
    // What goes public (into the PR) is what the provider gets: the confirmed text, else the card's
    // own. Each is refused by its own field, naming the pattern and never the secret.
    const body =
      options.description ??
      [card.description, card.issueRef ? closingLine(card.issueRef) : null]
        .filter((part) => part?.trim())
        .join("\n\n");
    const title = options.title ?? card.title;
    assertNoSecretInPr(this.port.opts.scanner, title, body);
    const project = this.port.project(card.projectId);
    const provider = (this.port.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider)
      throw new FlightdeckError(
        "invalid_state",
        "the project has no PR provider",
        "project_no_pr_provider",
      );
    const { worktreePath: cwd, branch } = card;
    if (!cwd || !branch)
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    // The provider's CLI takes the base as a plain argument (`az` reads `@file` as a file): a base an
    // older daemon stored without checking is refused here (issue #369), before anything is pushed.
    const base = assertBranchName(project.baseBranch);
    // Phase 40: the title the person confirmed, else the card's. The provider links the PR to the
    // issue and closes it on merge (`Fixes #n`, `AB#id`).
    const scanner = this.port.opts.scanner;
    const url = await publishPr({ cwd, branch, base, title, body, provider, scanner });
    this.port.db
      .query(
        `UPDATE cards SET pr_url = ?, pr_state = 'open', checks_state = NULL, pr_mergeable = NULL,
           pr_review = NULL, pr_opened_at = NULL, notice = NULL WHERE id = ?`,
      )
      .run(url, id);
    this.port.place(id, { type: "pr", state: "open" });
    this.port.armPoll();
    if (project.issues?.commentOnPr && card.issueRef) {
      await this.commentOnIssue(id, project.path, card.issueRef, url);
    }
    return this.port.card(id);
  }

  /** #1196: merges the card's open PR on its provider, then reads it again so the card moves to Done. */
  async mergePr(id: string, method: "merge" | "squash", confirm: boolean): Promise<Card> {
    if (!confirm) throw new FlightdeckError("invalid_state", "confirm the merge", "merge_confirm");
    const card = this.port.card(id);
    if (!card.prUrl) throw new FlightdeckError("invalid_state", "the card has no PR", "card_no_pr");
    if (card.prState !== "open") {
      throw new FlightdeckError("invalid_state", "the card's PR is not open", "card_pr_not_open", {
        url: card.prUrl,
      });
    }
    const project = this.port.project(card.projectId);
    const provider = (this.port.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider)
      throw new FlightdeckError(
        "invalid_state",
        "the project has no PR provider",
        "project_no_pr_provider",
      );
    if (!provider.merge) {
      throw new FlightdeckError(
        "invalid_state",
        "this PR provider cannot merge from Flightdeck",
        "card_pr_merge_unsupported",
        { url: card.prUrl },
      );
    }
    // From the main repository, as the poll: a cwd inside the worktree would lock it when it goes.
    await provider.merge({ cwd: project.path, url: card.prUrl, method });
    // Read again at once: the card moves to Done and its worktree goes, as for any merged PR.
    // A read that began before the merge landed may answer "open": let it end, then read again.
    await this.port.readInFlight(id)?.catch(() => {});
    // The PR is merged by now: a failed read is a notice, and the next round reads it again.
    await this.port.pollPr(id).catch((error: unknown) => {
      if (!this.port.stopped())
        this.port.setNotice(id, error instanceof Error ? error.message : String(error), error);
    });
    return this.port.card(id);
  }

  /** The review comments of the card's PR, as last fetched (fetched now when there are none). */
  async prComments(id: string): Promise<PrComment[]> {
    if (!this.port.card(id).prUrl)
      throw new FlightdeckError("invalid_state", "the card has no PR", "card_no_pr");
    return this.commentCache.get(id) ?? this.fetchComments(id);
  }

  /** Asks the provider; read only, nothing is posted back. */
  async fetchComments(id: string): Promise<PrComment[]> {
    const card = this.port.card(id);
    const project = this.port.project(card.projectId);
    const provider = (this.port.opts.prProvider ?? prProvider)(project.prProvider);
    if (!provider)
      throw new FlightdeckError(
        "invalid_state",
        "the project has no PR provider",
        "project_no_pr_provider",
      );
    const comments = await provider.comments({ cwd: project.path, url: card.prUrl as string });
    this.commentCache.set(id, comments);
    return comments;
  }

  /** Sends the chosen PR comments to the card's session, in the review's format. */
  async sendPrComments(id: string, ids: readonly string[]): Promise<{ sent: number }> {
    const chosen = (await this.prComments(id)).filter((c) => ids.includes(c.id));
    if (chosen.length === 0)
      throw new FlightdeckError("bad_request", "no comment was chosen", "pr_no_comment");
    this.port.message(id, prMessage(chosen));
    return { sent: chosen.length };
  }

  /** The card's worktree and branch, while no turn of its agent is going on. */
  private idleWorktree(id: string): { card: Card; worktree: string; branch: string } {
    const card = this.port.card(id);
    if (!card.worktreePath || !card.branch) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has no worktree yet",
        "card_no_worktree",
      );
    }
    if (card.queued || (card.sessionStatus !== null && BUSY.has(card.sessionStatus))) {
      throw new FlightdeckError(
        "invalid_state",
        "the card is running: wait for the agent to finish",
        "card_running",
      );
    }
    return { card, worktree: card.worktreePath, branch: card.branch };
  }

  /** Rebases the card's branch on its base; a conflict aborts and leaves the worktree as it was. */
  async updateFromBase(id: string): Promise<Card> {
    const { card, worktree } = this.idleWorktree(id);
    await rebaseOnto(worktree, refArg(this.port.project(card.projectId).baseBranch));
    return this.port.changed(id);
  }

  /**
   * "Merge e arquivar" for a card without a PR: into the base where it is checked out (clean), or
   * through a temporary worktree; then the card's worktree and branch go and it is Concluído.
   */
  async mergeLocal(
    id: string,
    mode: "merge" | "squash",
    confirm: boolean,
    /** Phase 40: the message the person confirmed, else the default of the mode. */
    message?: string,
  ): Promise<Card> {
    if (!confirm) throw new FlightdeckError("invalid_state", "confirm the merge", "merge_confirm");
    // The message goes into the base branch, public history: a secret in it is refused up front,
    // whether the person typed it or it is the default built from the card.
    const named = this.port.card(id);
    const found =
      this.port.opts.scanner?.scan(
        message ??
          (mode === "squash" ? named.title : `Merge ${named.branch ?? ""}: ${named.title}`),
      ) ?? [];
    if (found.length > 0) {
      throw new FlightdeckError(
        "bad_request",
        `the merge message looks like it has a secret (${found.join(", ")}): take it out before merging`,
        "merge_message_secret",
        { found: found.join(", ") },
      );
    }
    const { card, worktree, branch } = this.idleWorktree(id);
    if (card.prUrl) {
      throw new FlightdeckError(
        "invalid_state",
        "the card has a PR: the PR completes it",
        "card_has_pr",
      );
    }
    const pending = await pendingFiles(worktree);
    if (pending.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `the card's worktree has uncommitted changes: ${pending.join(", ")}`,
        "worktree_dirty",
        { files: pending.join(", ") },
      );
    }
    const project = this.port.project(card.projectId);
    const base = refArg(project.baseBranch);
    await assertLocalBranch(project.path, base);
    const { ahead } = await aheadBehind(worktree, base);
    if (ahead === 0)
      throw new FlightdeckError("invalid_state", `nothing ahead of ${base}`, "nothing_ahead", {
        base,
      });
    const text = message ?? (mode === "squash" ? card.title : `Merge ${branch}: ${card.title}`);
    await mergeIntoBase(project.path, base, refArg(branch), mode, text);
    // The merge is in the base now and cannot be undone: nothing below may leave the card out of
    // Concluído. What could not be cleaned up stays on the card as a notice.
    // Issue #1361: the worktree goes only once a check killed in it has exited.
    await this.port.loop()?.onStop(id);
    await this.port.closeRuns(id);
    const left = await this.removeMerged(project.path, worktree, branch);
    this.port.db
      .query("UPDATE cards SET worktree_path = ?, branch = ?, notice = ? WHERE id = ?")
      .run(left.worktree ? worktree : null, left.branch ? branch : null, left.notice, id);
    this.port.place(id, { type: "moved", column: "done" });
    return this.port.changed(id);
  }

  /**
   * Removes a merged card's worktree, then its branch (git does not delete a branch checked out
   * somewhere). A failure of either is reported, not thrown: on Windows a process may hold the
   * folder, and the merge is already in the base.
   */
  private async removeMerged(
    repo: string,
    worktree: string,
    branch: string,
  ): Promise<{ worktree: boolean; branch: boolean; notice: string | null }> {
    await this.port.settle();
    const removed = await git(repo, "worktree", "remove", worktree);
    if (removed.code !== 0) {
      const notice = `a pasta da worktree ficou em ${worktree}; remova depois (a branch ${branch} sai junto)`;
      return { worktree: true, branch: true, notice };
    }
    const deleted = await git(repo, "branch", "-D", refArg(branch));
    if (deleted.code !== 0) {
      const notice = `a branch ${branch} ficou (${deleted.stderr.trim()}); apague depois`;
      return { worktree: false, branch: true, notice };
    }
    return { worktree: false, branch: false, notice: null };
  }

  /** A comment with the PR's link on the card's issue; a failure only notices the card. */
  private async commentOnIssue(id: string, cwd: string, ref: string, url: string): Promise<void> {
    try {
      const parsed = parseIssueRef(ref) as NonNullable<ReturnType<typeof parseIssueRef>>;
      await (providerOfRef(ref) as NonNullable<ReturnType<typeof providerOfRef>>).comment(
        cwd,
        parsed.id,
        `PR aberto: ${url}`,
      );
    } catch (error) {
      const notice = `PR aberto, mas não comentou na issue: ${(error as Error).message}`;
      this.port.db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, id);
      this.port.changed(id);
    }
  }
}
