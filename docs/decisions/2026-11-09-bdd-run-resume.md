# BDD: run again from the failed step (issue #1356)

## Context

A failed workflow run goes on from its failed step as the same run, without running the finished
steps again, and says why it cannot when the workflow or the branch changed (#1266: daemon #1281,
hardening #1296, #1315 and #1333, app #1347).

## Decision

- `run-resume.feature`, three scenarios (en and pt-BR, 19 to 26 s each on the Pi), on a project of the
  scenario's own with a two-step workflow: the first step adds a line to a file of the card's
  worktree each time it runs, the second fails once.
  - the failed run offers "Run again from second"; pressing it ends the run completed and the file
    holds one line, so the first step did not run again;
  - after the workflow file is changed on the base branch and trusted again, the card says the
    workflow changed (`run_resume_workflow_changed`, in the language) and offers only Run again;
  - after the card's branch gets a commit, it says the branch moved (`run_resume_branch_moved`) and
    offers only Run again.
- Own state: the project, its workflow, card and worktree are the scenario's own. The existing
  "Run again" scenario shares its steps through two helpers (`trustWorkflow`, `startCardWith`).
- It goes red when the button pressed is Run again (from the start): the first step ran twice. It goes
  red when the branch does not move: the card still offers to go on.

## Not covered

A card that is gone or busy (`run_resume_card`), a run with no recorded head, a run that did not fail,
a far connection and a resume that waits for its slot across a restart: the card page cannot be
opened for a gone card, and a busy card shows another run, not this one. `run-resume` daemon tests
and `run-resume-ui` hold them.
