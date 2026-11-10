import type { Database } from "bun:sqlite";
import {
  contractOf,
  inSequence,
  missingFor,
  type SpecState,
  specExpectedPath,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { BoardEvent } from "./columns.ts";
import { git } from "./command.ts";
import { refArg } from "./ref-arg.ts";
import { readSpec } from "./spec.ts";
import {
  projectTemplate,
  type TemplateIgnored,
  type TemplateName,
  untrustedTemplate,
} from "./spec-template.ts";
import type { BoardColumn, BoardOptions, Card, Project } from "./types.ts";
import { must } from "./worktree.ts";

const now = () => new Date().toISOString();

/** What a card's lifecycle needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface CardLifecyclePort {
  db: Database;
  opts: Pick<BoardOptions, "specTemplateRoot" | "log" | "manager">;
  /** The workflow engine, as far as stopping and removing a card reads it. */
  workflows: {
    abandon: (cardId: string, why: string) => void;
    interrupt: (runId: string) => Promise<void>;
    forget: (cardId: string) => void;
  };
  card: (id: string) => Card;
  project: (id: string) => Project;
  changed: (id: string) => Card;
  place: (id: string, event: BoardEvent, via?: "completed") => void;
  emit: (card: Card) => void;
  setNotice: (id: string, notice: string, why?: unknown) => void;
  settleFix: (id: string, result: { isError: boolean; error: string }) => void;
  /** The check loop, when one runs (issue #1361): only its stop. */
  loop: () => { onStop(cardId: string): Promise<unknown> } | null;
  closeRuns: (id: string) => Promise<void>;
  finish: (id: string) => Promise<void>;
  unfollow: (cardId: string) => void;
  /** The board's end hooks (`addEnd`) for a card whose worktree is about to go. */
  runEnds: (cardId: string) => Promise<unknown>;
  settle: () => Promise<void>;
  variantIds: (cardId: string) => string[];
  dropConflicts: (id: string) => void;
  blockers: {
    blockingOf: (id: string) => string[];
    blockersOf: (id: string) => string[];
    afterBlockerChange: (id: string) => void;
  };
  stopped: () => boolean;
  /** Drops the card from the done log the ROI view reads (`roi/done-log.ts`). */
  forgetDone: (id: string) => void;
}

/**
 * Issue #1523: what happens to a card after it is made: moves (by the board and by a person,
 * against the column's contract), its spec and templates, stopping it, completing it, and
 * discarding or deleting it.
 */
export class CardLifecycle {
  /** Card id → the number of the last look at its spec file, so an older look writes nothing. */
  private readonly specLooks = new Map<string, number>();

  constructor(private readonly port: CardLifecyclePort) {}

  /** Moves the card by hand; Backlog and Concluído lock it there until the next start. */
  moveCard(id: string, column: BoardColumn, position?: number): Card {
    const { db } = this.port;
    const card = this.port.card(id);
    const { last } = db
      .query<{ last: number | null }, [string, string, string]>(
        "SELECT MAX(position) AS last FROM cards WHERE project_id = ? AND board_column = ? AND id <> ?",
      )
      .get(card.projectId, column, id) ?? { last: null };
    this.port.place(id, { type: "moved", column });
    db.query("UPDATE cards SET position = ? WHERE id = ?").run(position ?? (last ?? 0) + 1, id);
    return this.port.changed(id);
  }

  /**
   * A person's move (the app's `card.move`): a column that confirms refuses a card that lacks what
   * its contract asks, unless `force`, which records what the card lacked (issue #78). Every other
   * caller of the board moves with `moveCard`, which asks nothing.
   */
  async moveByHand(
    id: string,
    column: BoardColumn,
    position: number | undefined,
    force: boolean,
  ): Promise<Card> {
    const before = this.port.card(id);
    const overrides = this.port.project(before.projectId).contractByColumn;
    const contract = contractOf(column, overrides);
    // A card already in the column is only reordered; a column that hints never holds a card back.
    const asks = before.column !== column && contract?.enforce === "confirm";
    // The spec is a file that comes and goes: it is looked at now, only when the column asks.
    const card = asks && contract.checks.includes("spec") ? await this.refreshSpec(id) : before;
    const needs = asks ? missingFor(column, card, overrides) : [];
    const why = (code: "contract_unmet" | "invalid_state", text: string, reason: string) =>
      new FlightdeckError(code, text, reason, { column, needs: needs.join(",") });
    if (needs.length > 0 && !force) {
      throw why("contract_unmet", `${column} needs: ${needs.join(", ")}`, "card_contract_unmet");
    }
    // The last forced move's notice is stale once the card moves on.
    if (card.noticeReason === "card_moved_anyway") this.clearNotice(id);
    // Issue #1361: a card the person moved to another column leaves its check loop; a reorder in
    // its own column, or a move that was refused above, does not.
    if (before.column !== column) void this.port.loop()?.onStop(id);
    const moved = this.moveCard(id, column, position);
    if (needs.length === 0) return moved;
    const lacked = why(
      "invalid_state",
      `Moved to ${column} anyway: it lacked ${needs.join(", ")}.`,
      "card_moved_anyway",
    );
    this.port.setNotice(id, lacked.message, lacked);
    return this.port.changed(id);
  }

  /**
   * A project's own template from its trusted checkout, or why it gives none: the body when it is
   * there and used, `ignored` when it is there and not (an untrusted project, a link, too big,
   * empty), neither when there is none or the trust check failed (logged, never quoted).
   */
  async templateFor(
    cwd: string,
    name: TemplateName,
    own?: true,
  ): Promise<{ body: string | null; ignored: TemplateIgnored | null }> {
    const { opts } = this.port;
    if (!opts.specTemplateRoot) return { body: null, ignored: null };
    const asked = await opts.specTemplateRoot(cwd, own).then(
      (root) => ({ root }),
      (error: unknown) => {
        // The built-in template then, but a trust bug must not go unseen. Trust is unknown, so
        // the card says nothing about a template.
        opts.log?.(
          `${name} template: trust check failed for ${cwd}, built-in template used: ${String(error)}`,
        );
        return null;
      },
    );
    if (asked === null) return { body: null, ignored: null };
    if (asked.root) return projectTemplate(asked.root, name);
    return { body: null, ignored: (await untrustedTemplate(cwd, name)) ? "untrusted" : null };
  }

  /**
   * The project's own shape for a validation note (`.flightdeck/templates/validation.md`, trusted
   * projects only), given to the app as a placeholder and never saved; or why it was ignored
   * (issue #1058). Read from the trusted checkout; the card's worktree is only looked at by name
   * for an untrusted project, and a card with no worktree is asked for by its project's folder.
   */
  async validationTemplate(
    id: string,
  ): Promise<{ text: string | null; ignored: TemplateIgnored | null }> {
    const card = this.port.card(id);
    const found = card.worktreePath
      ? await this.templateFor(card.worktreePath, "validation")
      : await this.templateFor(this.port.project(card.projectId).path, "validation", true);
    return { text: found.body, ignored: found.ignored };
  }

  /**
   * Looks at the card's spec file again (the path set on the card, else `docs/specs/<slug>.md`)
   * in its worktree, and keeps whether it is there and its first heading (issue #78).
   */
  async refreshSpec(id: string): Promise<Card> {
    const { db } = this.port;
    const card = this.port.card(id);
    const path = specExpectedPath(card);
    const look = (this.specLooks.get(id) ?? 0) + 1;
    this.specLooks.set(id, look);
    const seen: SpecState | null =
      card.worktreePath && path ? { path, ...(await readSpec(card.worktreePath, path)) } : null;
    // The card may have been discarded, or the board stopped, while the files were read.
    if (this.port.stopped() || db.query("SELECT 1 FROM cards WHERE id = ?").get(id) === null) {
      return card;
    }
    // A look that ended after the card named another path or got another worktree says nothing
    // about the new one, and an older look never writes over a newer one.
    const now = this.port.card(id);
    if (specExpectedPath(now) !== path || now.worktreePath !== card.worktreePath) return now;
    if (this.specLooks.get(id) !== look) return now;
    if (JSON.stringify(seen) === JSON.stringify(now.specState)) return now;
    db.query(
      "UPDATE cards SET spec_checked_path = ?, spec_found = ?, spec_heading = ?, spec_draft = ? WHERE id = ?",
    ).run(seen?.path ?? null, seen?.found ? 1 : 0, seen?.heading ?? null, seen?.draft ? 1 : 0, id);
    return this.port.changed(id);
  }

  private clearNotice(id: string): void {
    this.port.db
      .query(
        "UPDATE cards SET notice = NULL, notice_reason = NULL, notice_params = NULL WHERE id = ?",
      )
      .run(id);
  }

  /**
   * A queued card leaves the queue and goes back to the Backlog. A running one has its turn
   * interrupted, and the interrupted turn sends it to Esperando você.
   */
  async stopCard(id: string): Promise<Card> {
    const card = this.port.card(id);
    void this.port.loop()?.onStop(id);
    if (card.queued) {
      this.port.db
        .query("UPDATE card_runs SET ended_at = ? WHERE card_id = ? AND started_at IS NULL")
        .run(now(), id);
      this.port.workflows.abandon(id, "card parado antes de começar");
      this.port.settleFix(id, { isError: true, error: "stopped before it started" });
      this.port.place(id, { type: "moved", column: "backlog" });
    } else if (card.workflowRunId) {
      await this.port.workflows.interrupt(card.workflowRunId);
    } else if (card.sessionId) {
      await this.port.opts.manager.interrupt(card.sessionId);
    }
    return this.port.changed(id);
  }

  /** Manual completion: Concluído (locked) and the same cleanup as a merged PR. */
  async completeCard(id: string, confirm: boolean): Promise<Card> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirm completing the card", "complete_confirm");
    this.port.place(id, { type: "moved", column: "done" }, "completed");
    await this.port.finish(id);
    return this.port.card(id);
  }

  /**
   * Throws the card away: sessions closed, worktree removed even with changes, local branch
   * deleted, card off the board. Returns its last state, marked `discarded`.
   */
  async discardCard(id: string, confirm: boolean): Promise<Card> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirm discarding the card", "discard_confirm");
    const card = this.port.card(id);
    // Issue #1361: the worktree goes only once a check killed in it has exited.
    await this.port.loop()?.onStop(id);
    // The variants of an arena go with its card.
    await inSequence(this.port.variantIds(id), async (variant) => {
      await this.discardCard(variant, true);
    });
    await this.port.closeRuns(id);
    this.port.unfollow(id);
    const repo = this.port.project(card.projectId).path;
    if (card.worktreePath) {
      await this.port.runEnds(id);
      await this.port.settle();
      must(
        await git(repo, "worktree", "remove", "--force", card.worktreePath),
        "git worktree remove",
      );
    }
    if (card.branch) must(await git(repo, "branch", "-D", refArg(card.branch)), "git branch -D");
    return this.removeFromBoard(id, "discarded");
  }

  /**
   * Deletes a card that never started (no worktree, no branch, no session, no run). Returns its
   * last state, marked `discarded` like a discarded card, so the app drops it the same way.
   * A card that started has work to clean up and goes through `discardCard`.
   */
  deleteCard(id: string, confirm: boolean): Card {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "confirm deleting the card", "delete_confirm");
    const card = this.port.card(id);
    const ran = this.port.db.query("SELECT 1 FROM card_runs WHERE card_id = ?").get(id) !== null;
    if (card.worktreePath || card.branch || card.sessionId || ran) {
      throw new FlightdeckError(
        "invalid_state",
        "the card already started: discard it instead of deleting it",
        "card_delete_started",
      );
    }
    return this.removeFromBoard(id, "deleted");
  }

  /** The card leaves the board and the cards it held up are free of it; `discardCard` cleans its worktree first. */
  removeFromBoard(id: string, verb: "discarded" | "deleted"): Card {
    const { db, blockers } = this.port;
    const last = this.port.card(id);
    this.port.workflows.forget(id);
    const holdingUp = blockers.blockingOf(id);
    const heldBy = blockers.blockersOf(id);
    db.query("DELETE FROM card_runs WHERE card_id = ?").run(id);
    this.port.forgetDone(id);
    db.query("DELETE FROM cards WHERE id = ?").run(id);
    this.port.dropConflicts(id);
    const gone = { ...last, worktreePath: null, branch: null, discarded: true };
    this.port.emit(gone);
    // A card that is gone can never be done: the cards it held up are free of it.
    const notice = `Blocker "${last.title}" was ${verb} and no longer blocks this card.`;
    for (const dependent of holdingUp) {
      db.query("UPDATE cards SET notice = ? WHERE id = ?").run(notice, dependent);
      blockers.afterBlockerChange(dependent);
      this.port.changed(dependent);
    }
    for (const blocker of heldBy) this.port.changed(blocker);
    return gone;
  }
}
