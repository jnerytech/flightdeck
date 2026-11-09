# BDD: keep going until the checks pass (issue #1463, for #1361)

## Context

The check loop (#1361: daemon #1447, card switch #1468) runs the project's checks when a plain card's
turn ends and sends a failure back to the same session as the next round. Its unit, component and
daemon tests hold the rules; no journey ran it with a real project, worktree and fake session.

## Decision

`check-loop.feature`, three scenarios (en and pt-BR), on a project of the scenario's own, no seed
change. The project holds `check.sh`; the project's check (Settings, Watch and fix PRs) is
`sh ./check.sh`; the project is trusted; the card's switch is turned on (the host asks for a
confirmation, the card not being in a mode that runs without asking) before the card starts.

- **A round, then review.** The script fails once and prints `[result:ok.txt]`. The round message
  carries that output, so the fake Claude writes `ok.txt` in its second turn and the next check
  passes. The card says "The checks passed.", the conversation holds one "Round 1 of 3" message and
  the card is in In review.
- **The round limit.** The script always fails. The card says the checks still failed after 3 rounds
  with the command, the conversation holds three round messages and the card is in In review.
- **A message from the person.** The script writes its process id and sleeps. While it runs, the
  person sends `[tool] ...`, which keeps the fake Claude's turn open on a permission. The card says
  "You took over, so the loop stepped aside.", the check's process (read from the file) is gone and no
  round was sent. Holding the turn open matters: once the person's turn ends, a new loop starts by
  design, and a finished turn would also replace the old check, so the first version of this scenario
  passed with the person's turn ignored.

Mutations, each red for the right reason: the output left out of the round message (the file is never
written, the card never says passed); the round limit one too high (four rounds); the person's turn
not stepping the loop aside (the card never says it stepped aside).

## Not covered

The "Round k of N: fixing" line (a fake turn is too short to stop on; `check-loop-ui` holds it), the
card's own lower round limit, the budget, quota and memory stops, a refused command and a restart
with a round open: the daemon tests hold them.
