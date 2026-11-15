import { parseWorkflow } from "./schema.ts";

/** Why a run cannot resume: the reason key the app translates, with its params. */
export interface ResumeRefusal {
  reason: string;
  params?: Record<string, string>;
}

/** What the engine knows of a failed run before it looks at the base branch or the worktree. */
export interface RunFacts {
  name: string;
  /** The run failed and no resume of it is running right now. */
  failedAndFree: boolean;
  /** The stored definition still hashes to the hash the run started from. */
  definitionIntact: boolean;
  /** Its card exists, is not discarded, has a worktree and still points at this run. */
  cardTakesIt: boolean;
  /** The run recorded the commit its worktree was at when it ended. */
  hasHead: boolean;
}

/** The first reason a run cannot resume from what the engine already holds, or null. */
export function resumeRefusal(run: RunFacts): ResumeRefusal | null {
  if (!run.failedAndFree) return { reason: "run_resume_not_failed" };
  // What runs is the stored definition: it must still be the one its hash names.
  if (!run.definitionIntact) {
    return { reason: "run_resume_workflow_changed", params: { name: run.name } };
  }
  if (!run.cardTakesIt) return { reason: "run_resume_card" };
  if (!run.hasHead) return { reason: "run_resume_no_head" };
  return null;
}

/**
 * The workflow on the base branch against the run's: refused when it changed (or cannot be read,
 * `sourceHash` undefined) or is no longer trusted. `trusted` is asked only for the same hash.
 */
export function sourceRefusal(
  name: string,
  runHash: string,
  sourceHash: string | undefined,
  trusted: () => boolean,
): ResumeRefusal | null {
  if (sourceHash !== runHash) return { reason: "run_resume_workflow_changed", params: { name } };
  if (!trusted()) return { reason: "workflow_not_trusted", params: { name } };
  return null;
}

/** #1266: the rows the engine names after a step: a parallel's items, a loop's check and do. */
export function childrenOf(definition: string, stepId: string): Set<string> {
  const step = parseWorkflow(definition).workflow?.steps.find((s) => s.id === stepId);
  if (!step) return new Set();
  if ("parallel" in step) return new Set(step.parallel.map((_, i) => `${stepId}.${i}`));
  if ("loop" in step) return new Set([`${stepId}.check`, `${stepId}.do`]);
  return new Set();
}

/**
 * The step rows a resume clears: those not completed, the failed step's own, and the rows named
 * after it, so a step whose id only looks like one of them keeps its result.
 */
export function staleRows<Row extends { step_id: string; status: string }>(
  rows: Row[],
  from: string,
  own: Set<string>,
): Row[] {
  return rows.filter(
    (row) => row.status !== "completed" || row.step_id === from || own.has(row.step_id),
  );
}
