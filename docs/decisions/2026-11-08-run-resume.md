# A failed workflow run resumes from its failed step (issue #1266)

## Context

"Run again" on a failed workflow run starts the whole workflow over: a new run, every step again.
A run that failed at step 3 of 4 repeats steps 1 and 2, with their agents' time and tokens. The
engine can already continue a run without repeating what finished: after a daemon restart,
`recover()` executes a run again, and `runStep` gives back the stored output of every step that is
`completed` in `step_runs`. Only a `failed` run never continues.

## Decision

- **Resume in place.** A failed run continues as the same run. It keeps its id, its stored
  workflow definition (`definition`, `workflow_hash`) and its inputs. Inputs are **not** read
  again: the outputs of the earlier steps were computed from them.
- **What persists.** Each completed step's row (output, outputs, session, usage) is replayed, not
  run again. A gate that was approved is not asked again. The run's usage keeps counting against
  the same budget.
- **What runs again.** The first step that is not completed (the failed one) and every step after
  it. The failed step's rows are cleared (each attempt, and its parallel items `<id>.<n>`), and it
  runs from scratch; an agent step gets a fresh session. The failure is kept in a new table,
  `run_resumes (run_id, n, from_step, reason, head, at)`, so the run's history shows each resume
  and what failed before it.
- **When a resume is refused.** The checks run when the app asks whether to offer it, and again
  when the person confirms. The reasons are:
  1. The run is not `failed` (`run_resume_not_failed`). A `rejected` run, from a gate's no or a
     stop, was a decision, not a fault.
  2. The card is gone, discarded, has no worktree, or has another run going
     (`run_resume_card`).
  3. The workflow file read again from the base branch no longer has the run's hash
     (`run_resume_workflow_changed`): the steps still to run may differ, and the earlier outputs
     may not fit them.
  4. The workflow is no longer trusted (`workflow_not_trusted`, as when it starts).
  5. The card's branch moved since the run ended (`run_resume_branch_moved`). The engine records
     the worktree's `HEAD` when a run fails (`workflow_runs.head_at_end`, a new column), and a
     resume needs the same `HEAD`. A commit, reset or rebase since then means the earlier outputs
     describe code that is no longer there.
  6. The run has no recorded `HEAD` (`run_resume_no_head`). This covers a run that ended before
     this change, and one that failed before any step ran (the worktree or its setup failed). It
     is refused, never allowed by default.
- **The command.** `run.resume { runId }` without `confirm` only checks. It answers
  `{ from, ok, reason?, params? }`, so the app offers "Run again from <step>" only when `ok`, and
  otherwise shows why. With `confirm: true` it checks again, records the resume, puts the card's
  run back to running (it waits for a slot like any run) and executes it. The confirm is
  near-only (`requireVaultTransport`), stricter than starting a card, since it runs the
  project's commands again. The check answers anywhere.

- **After a restart.** A resume still waiting for its slot when the daemon stops continues once
  the daemon is back, with the HEAD its resume recorded. It still needs the same HEAD once it
  gets a slot. Before that, it fails instead of running, for any of these reasons:
  - its card is gone or discarded, has no worktree, or runs another run (`run_resume_card`);
  - its stored definition no longer matches its hash, or the workflow is no longer trusted
    (`run_resume_workflow_changed`);
  - it has no recorded HEAD (`run_resume_no_head`).

  A step's own rows are the ones the engine names after it: `<id>.<n>` for a parallel item, and
  `<id>.check` and `<id>.do` for a loop. A resume clears exactly those, so a step whose id only
  looks like one of them keeps its result.

## Discarded alternatives

- **A new run that copies the outputs of the earlier steps.** Two runs would describe one piece of
  work, and the copies would need the same checks anyway.
- **Warn on a moved branch instead of refusing.** The earlier outputs, a plan or a review, would
  speak about code that changed. "Run again" from the start stays for that case.
- **Re-reading the inputs.** The earlier outputs would no longer match them.

## Consequences

- The migration adds `head_at_end` and `run_resumes`. Runs that ended before it cannot resume.
- Each resume of a run is listed in its history. A step's earlier failure stays readable there,
  even though its rows are cleared.
- The app (slice A) shows "Run again from <step>" on a failed run when the check says `ok`, and
  the reason when it does not. "Run again" from the start stays.
