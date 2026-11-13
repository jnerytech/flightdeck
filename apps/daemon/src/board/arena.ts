import type { Database } from "bun:sqlite";
import {
  type Arena,
  type ArenaVariant,
  type EffortLevel,
  inSequence,
  type PersonaRef,
  type WorkflowRun,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import type { BoardEvent } from "./domain/columns.ts";
import type { BoardOptions, Card, CardDiff } from "./types.ts";

const now = () => new Date().toISOString();

/** What an arena needs of the board (issue #1523); late-bound, so it never imports `board.ts`. */
export interface ArenasPort {
  db: Database;
  opts: Pick<BoardOptions, "suspendApproval" | "cardCost">;
  /** The workflow engine, as far as an arena reads it. */
  workflows: {
    getRun: (runId: string) => Pick<WorkflowRun, "steps">;
    active: (runId: string) => boolean;
  };
  card: (id: string) => Card;
  changed: (id: string) => Card;
  place: (id: string, event: BoardEvent) => void;
  refuseIfBlocked: (card: Card) => void;
  queued: (id: string) => boolean;
  createVariant: (
    projectId: string,
    input: {
      title: string;
      description: string;
      issueExternal: boolean;
      arenaOf: string;
      variant: {
        label: string;
        model: string | null;
        effort: EffortLevel | null;
        persona: string | null;
      };
    },
  ) => Card;
  startCard: (
    id: string,
    options: { workflow?: string; inputs?: Record<string, string>; persona?: PersonaRef },
  ) => Promise<Card>;
  discardCard: (id: string, confirm: boolean) => Promise<Card>;
  diff: (id: string) => Promise<CardDiff>;
  /** Whether a session in this state has let go of its slot (`FREES_SLOT`). */
  freesSlot: (status: NonNullable<Card["sessionStatus"]>) => boolean;
  unfollow: (cardId: string) => void;
  follow: (cardId: string, sessionId: string, sinceSeq: number) => void;
}

/**
 * Issue #1523: the arena: the same request in 2 to 4 variants, their comparison, and choosing
 * the one that carries on as the card.
 */
export class Arenas {
  constructor(private readonly port: ArenasPort) {}

  /**
   * "Iniciar em arena": the same request in 2 to 4 variants. Each is a card of its own, hidden
   * from the board, with its own worktree (`fd/<slug>-a`, `-b`…), session, queue entry and
   * slot, so the arena takes one slot per variant and a variant without one waits its turn.
   * Model and effort apply to plain requests; a workflow defines its own.
   */
  async startArena(
    cardId: string,
    input: {
      variants: Array<{
        model?: string;
        effort?: EffortLevel;
        persona?: PersonaRef;
      }>;
      workflow?: string;
      inputs?: Record<string, string>;
    },
  ): Promise<Arena> {
    const card = this.port.card(cardId);
    this.port.refuseIfBlocked(card);
    if (input.variants.length < 2 || input.variants.length > 4) {
      throw new FlightdeckError("bad_request", "an arena has 2 to 4 variants", "arena_variants");
    }
    if (card.arenaOf || card.arenaVariants > 0) {
      throw new FlightdeckError(
        "invalid_state",
        "the card is already in an arena",
        "arena_in_arena",
      );
    }
    if (card.queued || card.worktreePath || this.port.queued(cardId)) {
      throw new FlightdeckError(
        "invalid_state",
        "the card was already started: an arena starts from a new card",
        "card_started",
      );
    }
    const made: string[] = [];
    try {
      await inSequence(input.variants.entries(), async ([i, wanted]) => {
        const label = "abcd"[i] as string;
        const variant = this.port.createVariant(card.projectId, {
          title: `${card.title} (${label})`,
          description: card.description,
          // Third-party or agent text stays marked, and approval stays off, on every variant.
          issueExternal: card.issueExternal,
          arenaOf: cardId,
          variant: {
            label,
            model: wanted.model ?? null,
            effort: wanted.effort ?? null,
            persona: wanted.persona?.id ?? wanted.persona?.definition?.id ?? null,
          },
        });
        made.push(variant.id);
        if (card.issueExternal) {
          this.port.opts.suspendApproval?.(
            variant.id,
            "arena variant of a card with outside content",
          );
        }
        await this.port.startCard(variant.id, {
          workflow: input.workflow,
          inputs: input.inputs,
          persona: wanted.persona,
        });
      });
    } catch (error) {
      // Half an arena is nothing: the variants already made go, and the card stays as it was.
      await inSequence(made, async (id) => {
        await this.port.discardCard(id, true);
      });
      throw error;
    }
    this.port.place(cardId, { type: "started" });
    this.port.changed(cardId);
    return this.arena(cardId);
  }

  /** The comparison: each variant's diff, workflow checks, cost, duration and state. */
  async arena(cardId: string): Promise<Arena> {
    this.port.card(cardId);
    const ids = this.variantIds(cardId);
    return { cardId, variants: await Promise.all(ids.map((id) => this.variantView(id))) };
  }

  variantIds(cardId: string): string[] {
    return this.port.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM cards WHERE arena_of = ? ORDER BY created_at, rowid",
      )
      .all(cardId)
      .map((row) => row.id);
  }

  private async variantView(id: string): Promise<ArenaVariant> {
    const card = this.port.card(id);
    const startedAt = card.runs[0]?.startedAt ?? null;
    const finished = card.sessionStatus !== null && this.port.freesSlot(card.sessionStatus);
    const endedAt = card.runs.at(-1)?.endedAt ?? (finished ? card.updatedAt : null);
    const files = card.worktreePath
      ? (await this.port.diff(id)).files.map(({ path, additions, deletions }) => ({
          path,
          additions,
          deletions,
        }))
      : [];
    const steps = card.workflowRunId ? this.port.workflows.getRun(card.workflowRunId).steps : [];
    return {
      id,
      label: card.variant?.label ?? "?",
      model: card.variant?.model ?? null,
      effort: card.variant?.effort ?? null,
      persona: card.variant?.persona ?? null,
      branch: card.branch,
      worktreePath: card.worktreePath,
      queued: card.queued,
      sessionStatus: card.sessionStatus,
      column: card.column,
      startedAt,
      endedAt,
      durationMs: startedAt
        ? Math.max(0, Date.parse(endedAt ?? new Date().toISOString()) - Date.parse(startedAt))
        : null,
      costUsd: this.port.opts.cardCost?.(id) ?? null,
      files,
      checks: steps
        .filter((step) => step.type === "check")
        .map((step) => ({ stepId: step.stepId, status: step.status })),
      notice: card.notice,
    };
  }

  /**
   * "Escolher": the variant becomes the card's worktree, branch and runs, and carries on as a
   * normal card; the other variants are stopped and removed. Only a variant that has stopped.
   */
  async chooseVariant(cardId: string, variantId: string, confirm: boolean): Promise<Card> {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "choosing a variant removes the others: confirm first",
        "arena_choose_confirm",
      );
    }
    this.port.card(cardId);
    const ids = this.variantIds(cardId);
    if (!ids.includes(variantId)) {
      throw new FlightdeckError(
        "not_found",
        `variant ${variantId} is not in this arena`,
        "arena_variant_unknown",
        { variant: variantId },
      );
    }
    const chosen = this.port.card(variantId);
    const working =
      chosen.queued ||
      this.port.queued(variantId) ||
      (chosen.workflowRunId !== null && this.port.workflows.active(chosen.workflowRunId));
    if (working) {
      throw new FlightdeckError(
        "invalid_state",
        "the variant is still running: wait for it to finish",
        "arena_variant_running",
      );
    }
    await inSequence(ids, async (id) => {
      if (id !== variantId) await this.port.discardCard(id, true);
    });
    this.port.unfollow(variantId);
    const { db } = this.port;
    db.transaction(() => {
      for (const table of ["card_runs", "workflow_runs"]) {
        db.query(`UPDATE ${table} SET card_id = ? WHERE card_id = ?`).run(cardId, variantId);
      }
      db.query(
        `UPDATE cards SET slug = ?, branch = ?, worktree_path = ?, board_column = ?,
           column_locked = ?, notice = ?, updated_at = ? WHERE id = ?`,
      ).run(
        chosen.slug,
        chosen.branch,
        chosen.worktreePath,
        chosen.column,
        chosen.columnLocked ? 1 : 0,
        chosen.notice,
        now(),
        cardId,
      );
      db.query("DELETE FROM cards WHERE id = ?").run(variantId);
    })();
    const moved = this.port.card(cardId);
    if (moved.sessionId) this.port.follow(cardId, moved.sessionId, 0);
    return this.port.changed(cardId);
  }
}
