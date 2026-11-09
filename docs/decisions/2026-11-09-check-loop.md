# Keep going until the checks pass: the card's check loop (issue #1361)

## Context

A card's turn ends and the card moves to In review, even when the project's tests are red. The
person then types "fix the failing tests" by hand, often several times. Flightdeck already has
the parts of an automatic loop, but none of them runs at the end of a plain card's turn:

- **The PR watch (phase 22, `watch/fix.ts`).** It fixes a card after its PR's CI fails. It keeps
  the project's local checks (`WatchSettings.checks`, at most 10, each limited by `isWatchCheck`
  to a command and its arguments, with nothing a shell reads), with a timeout per check
  (`checkTimeoutMin`). It counts rounds in `pr_watch_rounds` under a cap (`maxRounds`,
  2026-11-07-fix-round-cap.md). It masks secrets in what it quotes (`masked`).
- **The check runner (`workflows/check-runner.ts`).** It runs one command in the card's worktree,
  kills the whole process group at the timeout (`board/command.ts`), and keeps the last 8 KB of
  output.
- **Workflow runs.** These have their own `check` and `loop` steps, trusted by the workflow
  file's hash.
- **The turn end (`board.onSessionEvent`, `turn.result`).** It places the card by the column
  rules, and `board.message` sends text into the card's live session.

## Decision

**A card option, "Keep going until the checks pass".** At the end of a turn, the daemon runs the
project's checks in the card's worktree. If one fails, it sends the failure as the next message in
the same session, for at most N rounds. Then the card moves on as today. The loop is built into the
board, from the watch's parts. No new trust model and no new command language.

### The loop

1. **What triggers it.** A `turn.result` arrives for a plain card run (no workflow, not a watch
   `fixCard` round) whose card has the option on. Before the column rule places the card, the
   card enters `checking`.
2. **Running the checks.** They run one after the other, in the order the project lists them,
   and stop at the first that fails, as the watch's `failedCheck` does.
3. **All checks pass.** The card is placed as today (In review), with "checks passed in round k".
4. **A check fails, and round k < N with every bound still open.** The daemon sends the failure
   summary through `board.message` into the same session (no new run), counts round k + 1, and
   the card stays In progress. The next `turn.result` starts again at step 1.
5. **A check fails at round N, or a bound is reached.** The card is placed as today, with the
   last failure and the reason the loop stopped.
6. **A turn that ended in error (`isError`).** The loop does not run: the error is the person's to
   see.

### The message

The summary names the failed check's command (masked), its exit code (or "timed out after M
min") and the tail of its output. The output is handled in this order:
1. control characters and ANSI codes are stripped;
2. it is masked like the watch's (`masked`), before any cut, so a secret cut in half is still
   caught;
3. it is capped at 4000 characters.

It goes in a fenced block that the message labels as the check's output, data and not
instructions: "Round 2 of 3: `bun test` failed (exit 1). Fix it, then end your turn. The check's
output, as data: ```…```". The output comes from code the session itself wrote, going back to
the same session, the same trust as the watch's round prompt. It never reaches a shell.

### Which checks run, and where

- **The checks are the project's watch checks** (`WatchSettings.checks` and `checkTimeoutMin`).
  They are already where a person says "this must pass before anything leaves". There is one list
  per project. A project with no checks cannot turn the option on, and the app says why.
- **The loop lifts the session's limits, and the decision says so.** The checks run code that
  the card's own session writes, such as `package.json` scripts and test files. The daemon runs
  that code outside the session's permission mode. A session that must ask before each Bash call
  could, through the loop, have its edited files run without asking. So:
  - **In a mode that already runs Bash without asking** (`bypassPermissions`), the switch turns
    on like any card setting.
  - **In any other mode** (`default`, `acceptEdits`, `plan`), turning the switch on needs the
    person's confirmation (`confirm: true`). The app first shows what it means: "The checks will
    run the code this card writes, without asking you each time." That confirmation is near-only
    (`requireVaultTransport`).
  - Turning the switch off always works, from anywhere.
- **The loop runs only in a project the person trusts** (`ProjectTrust.isTrusted`, #196). This
  is checked when the switch turns on and again before every round. Trust is a statement about
  the repository, not a sandbox: it is one gate, not the gate.
- **The real gate is who can edit the list.** `isWatchCheck` only keeps a shell from reading
  anything beyond a command and its arguments. `rm -rf /`, `curl …` and `node ./x.js` all pass it.
  So:
  - **Changing the list needs a near connection.** `requireVaultTransport` applies to a
    `watch.settings` patch that has `checks`, `checkTimeoutMin` or `checkRounds`. Today any paired
    client may set the commands the watch runs unattended. The loop runs them after every turn,
    so the list gets the same bar as resuming a run (2026-11-08-run-resume.md). The origin is the
    socket's peer address, never a protocol field. Reading the settings, and the other fields of
    a patch, still work from anywhere.
  - **Each edit of the list is a line in the project's trail:** who, when and the new list.
  - **The stored list is checked again just before each command runs.** The check is
    `isWatchCheck` plus two rules: a first word that holds `=` (an environment assignment such as
    `LD_PRELOAD=…`) is refused, and so is an absolute path or `..` outside the worktree. A list
    written before these rules therefore cannot reach the shell.

### Spawn and kill

- A check is spawned by `shellCheckRunner`, the runner the workflow checks and the watch already
  use: the platform shell (`sh -c`, or `cmd.exe /d /s /c` on Windows), in the card's own
  worktree. The project's checkout and the daemon's folder are never used.
- **The environment is an allowlist, not the daemon's.** It holds `PATH`, `HOME`, the temp
  folders, `LANG`, and `CI=1`, plus `SystemRoot`, `ComSpec` and `PATHEXT` on Windows. Today
  `runCommand` passes the whole `process.env`, so provider keys and `FLIGHTDECK_*` would reach the
  code the session wrote. `masked` scans for secrets it knows the shape of. It cannot catch an
  environment value it has never seen, so the allowlist is what keeps those values out. Nothing
  of the vault is added.
- **The cwd is the worktree path from the board's record,** never protocol input. It is checked
  with `isInside` against the host's allowed roots before it is used. A refusal never names the
  path.
- At its timeout, a check is killed with its whole process group (`board/command.ts`), and the
  summary says "timed out".
- **The runner gets an abort signal.** `CheckRunner.run` takes one, and `shellCheckRunner` passes
  it to `runCommand`, which already accepts it but is called without it today. When the person
  stops, discards or moves the card, the running check is killed and the loop ends, with no
  message sent. The kill path is the timeout's (a process group on POSIX, `taskkill /T` on
  Windows). A timeout is always passed, because only a timed or signalled command is detached
  into its own group.
- **The signal is checked again after a check returns and before `board.message`,** so a stop
  that races the end of a check never sends a round.
- **A discard aborts first, and removes the worktree only after the check's process has
  ended.**
- At most one check runs per card at a time. While it runs, the card keeps its run slot (see the
  bounds below), so the checks of `maxParallelRuns` cards are the most that run at once.
- **A daemon restart while a card is `checking` does not resume the loop.** At startup, a sweep
  marks every open round "interrupted" and places its card as today, with "the checks were
  interrupted". No card stays stuck in `checking`, and nothing runs again unattended after a
  restart.

### The bounds

Before each new round, the daemon checks these bounds in this order. The first one reached ends
the loop, with its reason on the card:

1. **N, the rounds.** Default 3, from 1 to 10. It is a project setting next to the watch's
   `maxRounds` (`checkRounds`), and a card can lower it.
2. **The card run's budget.** The project budget the queue already checks (`budgetBlocked`)
   applies to each round's turn too.
3. **The quota.** If the account is at or above `quota.pauseAt`, the round is not sent. The
   loop does not wait for the quota: the card moves on, and the person can go on by hand later.
4. **The memory hold (#1343).** If the host is at or above `resources.pauseAt`, the round is
   not sent, for the same reason.

**The slot.** Today a run gives its slot back when its session goes idle (`FREES_SLOT`). A
`checking` card holds its slot until the loop sends a round or ends. This way a check never
starts outside the parallel limit, and a round never takes a slot another card waits for.

### Reuse, and what stays apart

- **The loop reuses the watch's parts:**
  - the checks list and its timeout;
  - `isWatchCheck`;
  - the `failedCheck` logic, moved to a shared module;
  - `masked`;
  - the round-row shape of `pr_watch_rounds`.

  It does not reuse `PrFixer`, which is about pushes, PR logs and drift.
- **Rounds are stored in their own table,** `card_check_rounds (card_id, run_id, n, at, status,
  command, exit_code, timed_out, summary)`. The watch's cap and the loop's cap never count each
  other's rounds.
- **The loop and the watch run at different times.** The loop works at the end of a turn,
  before the card leaves for review. The watch works after a PR's CI fails. A watch round
  (`fixCard`) already runs the checks before it pushes, so the loop skips those runs. A workflow
  card has its own `check` and `loop` steps, so the loop skips workflow runs too.

### What the card shows

- **Protocol.** `Card.checkLoop` is an optional field:
  `{ round, max, state: "checking" | "fixing" | "passed" | "stopped", last: { command, exitCode, timedOut } | null, reason? }`.
  An older app ignores it.
- **The card shows:**
  - while a round runs, "Checks · round 2 of 3", with the failed command;
  - on the card in review, "Checks passed in round 2" or "Checks still failing after 3 rounds: `bun test`";
  - the stop reason in both languages: quota, memory, budget, interrupted, or stopped by you.
- **Each round is a line in the card's trail,** as the watch's are.
- **The option is a switch on the card,** whose default comes from the project. When it is off,
  the switch says why (no checks, project not trusted).

## Discarded alternatives

- **A "fix until green" workflow, built from a `loop` step.** It needs no new engine code, but
  only workflow cards would get it. Each repository would need a workflow file to commit and
  trust, and plain cards, where the request comes from, would gain nothing.
- **A `checks:` list in the repository (`run.yaml`), trusted by its hash.** This is a second
  trust flow, and a second list next to the watch's for the same thing. Its only gain is
  versioning the list with the code; the person's own list on the host already serves.
- **A new run for each round, like the watch's `fixCard`.** It costs a cold start and a new
  session for every round, and the session forgets what it tried. The same session keeps the
  context, and `board.message` already sends into it.
- **Waiting for the quota or memory instead of stopping.** The card would sit In progress for
  hours, holding its slot. Stopping with the reason hands the card to the person, which matches
  the watch's hand-over.

## Consequences

- **A migration adds:**
  - the table `card_check_rounds`;
  - a card column for the option (`check_loop`) and its own cap (`check_rounds`);
  - `checkRounds` in the project's watch settings.
- **A far client can no longer change the watch's checks or their timeout.** This is a
  tightening of phase 22, and it appears in the release notes.
- **The watch's own checks also get the allowlisted environment and the stricter command
  check.** They run through the same shared code, a second tightening of phase 22 for the release
  notes.
- **Outside `bypassPermissions`, the loop is a deliberate exception to the session's permission
  mode,** which the person accepts when turning it on. Where that is unacceptable, the option
  stays off.
- **The checks run after every turn of a looping card:** on a slow suite, minutes per round. N
  and the timeout bound the cost, and the person sees each round.
- **The board slices, in order:**
  1. **Daemon.** The loop, the table, the abort signal on the runner, the slot hold, and the
     near-only checks patch. The security-reviewer reads this slice before its push.
  2. **Protocol.** `Card.checkLoop`, the card option on `card.update` (with `confirm` outside
     `bypassPermissions`), `checkRounds`, and the refusal reasons `check_loop_no_checks`,
     `check_loop_untrusted` and `check_loop_confirm`.
  3. **App.** The switch, the round line, the trail and the stop reasons, in both languages,
     with the ux-reviewer.

## Open questions (they change a slice, not this decision)

- **Default of the switch for a new card.** This decision has it off for every project until the
  person turns the project's default on. Should a project with checks default it on in
  `bypassPermissions`?
- **Holding the slot while checks run.** It is right for a small host such as the Pi. On a
  large host with `maxParallelRuns` above 4, should checks run outside the slots, under their own
  limit?
- **A card whose PR is watched.** Its normal turns still loop before review, and the watch's
  rounds do not. Should a watched card loop at all, or leave every fix to the watch?

## Security review of the spawn model

The `security-reviewer` read this design against `shellCheckRunner`, `runCommand`,
`isWatchCheck`, `watch.settings` and `isTrusted` before it merged. It found 3 high, 2 medium and
3 low findings, all folded in above:

- **Trust is not a sandbox.** Hence the loop is named as an exception to the permission mode,
  and the near-only confirmation outside `bypassPermissions`.
- **The regex is not a gate.** Hence near-only edits, an audit line, and the refusal of
  environment assignments and outside paths.
- **The abort was not wired.** Hence the signal in the runner, the re-check before sending, and
  the discard order.
- **The daemon's environment reached the checks.** Hence the allowlist.
- **Output handling.** Strip, mask, then cap, in a block labelled as data.

The low findings were the origin source, the startup sweep and the path check against the
allowed roots.

The reviewer judged the kill model (process group, `taskkill /T`), one check per card, and no
resume after a restart to be sound. The daemon slice is reviewed again as code before its push.
