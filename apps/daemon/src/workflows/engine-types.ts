import type { Database } from "bun:sqlite";
import type { RunStatus, StepRun, StepStatus, StepType } from "@flightdeck/protocol";
import type { BoardEvent } from "../board/domain/columns.ts";
import type { Card } from "../board/types.ts";
import type { Prepare } from "../personas/index.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { CheckRunner } from "./check-runner.ts";
import type { CardsRaised, Finding } from "./findings.ts";
import * as col from "./row-json.ts";

/**
 * The workflow engine's ports and its rows (#1595): what it needs from the board and the host,
 * and the run and step rows the engine and its step runner both read.
 */

/** What the engine needs from the board that owns the cards. */
export interface EngineHost {
  place(cardId: string, event: BoardEvent): void;
  /** The run stopped holding the card's slot in the host queue. */
  release(cardId: string): void;
  /** Back from a restart: the card's run holds its slot again, without waiting. */
  hold(cardId: string): void;
  /** Over the plan quota: when it frees (`until` in ms, if known); `null` when a turn may go. */
  waitQuota(): { until: number | null; done: Promise<void> } | null;
  /** Takes a slot for the card again, waiting in the host queue (ahead of queued cards). */
  acquire(cardId: string): Promise<void>;
  /** Up to `count` free slots of the host right now, without waiting; `release` gives each back. */
  takeSlots(cardId: string, count: number): string[];
  /** Pushes the card's branch and opens its PR (phase 4); the PR's URL. */
  createPr(cardId: string): Promise<string>;
  /** Issue #79: raises findings as Backlog cards of the card's project. */
  raiseCards(
    cardId: string,
    findings: readonly Finding[],
    origin: { workflow: string; runId: string },
  ): CardsRaised;
  card(cardId: string): Card;
}

export interface WorkflowEngineOptions {
  db: Database;
  manager: SessionManager;
  /** Reads the personas for a session about to open; none when absent. */
  preparePersonas?: Prepare;
  host: EngineHost;
  checks: CheckRunner;
  /** Milliseconds now: the budget's minutes. */
  clock: () => number;
  /** #1266: the commit a worktree is at; null when git cannot say. The real git when absent. */
  headOf?: (worktree: string) => Promise<string | null>;
}

export interface RunRow {
  id: string;
  card_id: string;
  workflow_name: string;
  workflow_hash: string;
  definition: string;
  status: RunStatus;
  status_reason: string | null;
  status_reason_key: string | null;
  status_reason_params: string | null;
  budget: string;
  usage: string;
  inputs: string;
  started_at: string;
  ended_at: string | null;
  /** #1266: the worktree's HEAD when the run failed; null before the column, or with no step run. */
  head_at_end: string | null;
}

export interface StepRow {
  run_id: string;
  step_id: string;
  attempt: number;
  type: StepType;
  status: StepStatus;
  session_id: string | null;
  output: string | null;
  exit_code: number | null;
  note: string | null;
  message: string | null;
  usage: string | null;
  started_at: string;
  ended_at: string | null;
}

export const toStep = (row: StepRow): StepRun => ({
  stepId: row.step_id,
  attempt: row.attempt,
  type: row.type,
  status: row.status,
  sessionId: row.session_id,
  output: row.output,
  exitCode: row.exit_code,
  note: row.note,
  message: row.message,
  usage: col.stepUsageOf(row.usage),
  startedAt: row.started_at,
  endedAt: row.ended_at,
});

export const now = () => new Date().toISOString();

export const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
