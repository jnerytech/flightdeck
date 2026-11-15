/**
 * The rules of an arena (issue #1523): when one may start, what each variant card is made of, and
 * how a variant reads in the comparison. No I/O: the clock and what the board knows come in.
 */
import type { ArenaVariant, EffortLevel, PersonaRef, WorkflowRun } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import type { Card } from "../types.ts";

/** What one wanted variant asks for. */
export interface WantedVariant {
  model?: string;
  effort?: EffortLevel;
  persona?: PersonaRef;
}

/** The card a variant is created as: hidden from the board, linked to the card of the arena. */
export interface VariantInput {
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
}

/** Why an arena may not start from this card; nothing when it may. `queued` is the queue's view. */
export function refuseArenaStart(
  card: Card,
  variantCount: number,
  queued: boolean,
): FlightdeckError | null {
  if (variantCount < 2 || variantCount > 4) {
    return new FlightdeckError("bad_request", "an arena has 2 to 4 variants", "arena_variants");
  }
  if (card.arenaOf || card.arenaVariants > 0) {
    return new FlightdeckError(
      "invalid_state",
      "the card is already in an arena",
      "arena_in_arena",
    );
  }
  if (card.queued || card.worktreePath || queued) {
    return new FlightdeckError(
      "invalid_state",
      "the card was already started: an arena starts from a new card",
      "card_started",
    );
  }
  return null;
}

/** The input of the variant at `index` (a, b, c, d). */
export function variantInput(card: Card, index: number, wanted: WantedVariant): VariantInput {
  const label = "abcd"[index] as string;
  return {
    title: `${card.title} (${label})`,
    description: card.description,
    // Third-party or agent text stays marked, and approval stays off, on every variant.
    issueExternal: card.issueExternal,
    arenaOf: card.id,
    variant: {
      label,
      model: wanted.model ?? null,
      effort: wanted.effort ?? null,
      persona: wanted.persona?.id ?? wanted.persona?.definition?.id ?? null,
    },
  };
}

/** What the comparison reads of a variant besides its card. */
export interface VariantReading {
  /** Whether the variant's session has let go of its slot. */
  finished: boolean;
  files: Array<{ path: string; additions: number; deletions: number }>;
  steps: WorkflowRun["steps"];
  costUsd: number | null;
  /** The moment the comparison is read, an ISO string. */
  now: string;
}

/** A variant as the comparison shows it: its card, how long it ran, what it changed and checked. */
export function variantViewOf(card: Card, reading: VariantReading): ArenaVariant {
  const startedAt = card.runs[0]?.startedAt ?? null;
  const endedAt = card.runs.at(-1)?.endedAt ?? (reading.finished ? card.updatedAt : null);
  return {
    id: card.id,
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
      ? Math.max(0, Date.parse(endedAt ?? reading.now) - Date.parse(startedAt))
      : null,
    costUsd: reading.costUsd,
    files: reading.files,
    checks: reading.steps
      .filter((step) => step.type === "check")
      .map((step) => ({ stepId: step.stepId, status: step.status })),
    notice: card.notice,
  };
}
