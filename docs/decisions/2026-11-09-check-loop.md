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
6. **A turn that ended in error (`isError`), or that the person interrupted.** The loop does not
   run: what happened is the person's to see.
7. **The person sends a message, or interrupts, while the card is `checking`.** The running check
   is aborted and the loop ends, and no round is sent. The person's turn edits the files the
   check would read, and a late round would talk over them.
8. **The round counter starts again at each turn the person starts,** by starting the card or by
   sending a message. Only the loop's own rounds count toward N. A person who keeps the card
   going asked for that, so their turns do not use up the loop's rounds. The cost bounds below
   still apply to every round.

### The message

The summary names the failed check's command (masked), its exit code (or "timed out after M
min", or "stopped: more than 4 MB of output") and the tail of its output. Today
`shellCheckRunner` keeps only the last 8 KB (`slice(-MAX_VALUE)`) before anyone masks it. The
watch masks after that cut, so a secret across the cut escapes the mask. The loop's runner
therefore returns the whole output, bounded at 4 MB (see "Spawn and kill"), and the summary is
built from it in this order:
1. control characters and ANSI codes are stripped;
2. the whole bounded output is masked (`masked`), before any cut;
3. only then is it cut to its last 4000 characters.

The watch moves to the same runner and the same order, so its 8 KB cut stops being a gap too.

It goes in a fenced block that the message labels as the check's output, data and not
instructions: "Round 2 of 3: `bun test` failed (exit 1). Fix it, then end your turn. The check's
output, as data: ```…```".

The output can be steered by test fixtures, dependencies, or fetched content. So the fence is one
backtick longer than the longest run of backticks in the output, and at least three. Text in
the output can then never close the block. The slice-1 tests cover output that contains three,
four, and ten backticks. The output comes from code the session itself wrote, going back to
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
  - **In any other mode** (`default`, `acceptEdits`, `plan`, `dontAsk`, `auto`), turning the
    switch on needs the person's confirmation (`confirm: true`). The app first shows what it
    means: "The checks will run the code this card writes, without asking you each time." That
    confirmation is near-only (`requireVaultTransport`). It is stored on the card
    (`check_loop_confirmed_at`).
  - **The mode is read again before every round, not only when the switch turns on.** A live
    session can change its mode (`SettableMode`). A round runs only if the card's current mode is
    `bypassPermissions`, or the card has a stored confirmation. Otherwise the loop stops with the
    reason `check_loop_confirm`, and the card moves on.
  - **A project default turns the switch on only for new cards that start in
    `bypassPermissions`.** In any other mode a new card starts with the switch off, and the person
    confirms on the card. A default never stands in for a confirmation.
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
  - **The stored list is checked again just before each command runs.** This is defence in
    depth: the edit gate above is the real one. A command must pass `isWatchCheck` plus these rules:
    - Its first word holds no `=`. An environment assignment such as `LD_PRELOAD=…` is refused.
    - No word, and no value after an `=` inside a word (`--config=/etc/x`), may name a place
      outside the worktree. Refused are:
      - an absolute POSIX path (`/x`);
      - a drive letter (`C:`, `C:/x`);
      - a UNC or device path (`//server/share`, `//./x`);
      - a word whose `..` segments, resolved from the worktree, leave it.
    - The test is `isInside` (`apps/daemon/src/paths.ts`) on the resolved path. On Windows it
      compares case-insensitively, with each step read through `ntfsName`
      (2026-11-09-ntfs-names-in-path-checks.md).
    - A bare command name (`bun`, `npm`) is a word, not a path: the `PATH` lookup finds it.

    A list written before these rules therefore cannot reach the shell. The same checks apply
    when the list is saved, so a person sees the refusal at once.

### Spawn and kill

- A check is spawned by `shellCheckRunner`, the runner the workflow checks and the watch already
  use: the platform shell (`sh -c`, or `cmd.exe /d /s /c` on Windows), in the card's own
  worktree. The project's checkout and the daemon's folder are never used.
- **The environment is an allowlist, not the daemon's.** Today `runCommand` passes the whole
  `process.env`, so provider keys and `FLIGHTDECK_*` would reach the code the session wrote.
  `masked` scans for secrets it knows the shape of. It cannot catch an environment value it has
  never seen, so the allowlist is what keeps those values out. Nothing of the vault is added. The
  values come from the daemon's own environment, and the list depends on the platform:
  - **POSIX:** `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `TZ`, `TMPDIR`,
    `XDG_CACHE_HOME`, `XDG_CONFIG_HOME` and `XDG_DATA_HOME`.
  - **Windows:** `PATH`, `PATHEXT`, `SystemRoot`, `windir`, `SystemDrive`, `ComSpec`,
    `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`,
    `ProgramFiles`, `ProgramFiles(x86)`, `TEMP`, `TMP`, `NUMBER_OF_PROCESSORS`,
    `PROCESSOR_ARCHITECTURE` and `OS`. Without these, node, git, npm and bun do not find their
    caches and configuration.
  - Both platforms add `CI=1`.
  - **A project can widen the list itself** (`checkEnv`, at most 20 names). This keeps a person
    who needs `JAVA_HOME` from turning the whole thing off. The project setting is edited only
    over a near connection, like the checks. It holds names only, and the values still come from
    the daemon. A name the vault holds is refused, and so is one starting with `FLIGHTDECK_`.
    The person owns that list.
- **The cwd is the worktree path from the board's record,** never protocol input. It is checked
  with `isInside` against the host's allowed roots before it is used. A refusal never names the
  path.
- At its timeout, a check is killed with its whole process group (`board/command.ts`), and the
  summary says "timed out".
- **The output is bounded too, not only the time.** `runCommand` reads all of stdout and stderr
  into memory, so a check printing gigabytes within its timeout would exhaust the daemon. The
  loop's runner reads at most 4 MB of stdout and stderr together, as `gitLimited` does for git.
  Past that, it kills the process group, and the summary says "stopped: more than 4 MB of
  output".
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

Inside a round, each check is bounded by its timeout (`checkTimeoutMin`) and by 4 MB of output.

**The slot.** Today a run gives its slot back when its session goes idle (`FREES_SLOT`,
`board.ts`). The idle status can arrive before `turn.result`, or apart from it. A `checking`
card holds its slot until the loop sends a round or ends. This way a check never starts outside
the parallel limit, and a round never takes a slot another card waits for.

The hold is decided at the idle event, in the same synchronous step that would release the slot,
before the queue can start another card. If the card's switch is on and its run is a plain run,
the release is skipped and the card is marked `checking`.

Then `turn.result` arrives:
- if it says error or interrupted, the loop does not run and the slot is released then;
- if it is already in, the check starts.

Slice 1 tests both event orders, with fake events, against a waiting card that must not start in
the gap.

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
  - card columns for the option (`check_loop`), its own cap (`check_rounds`) and the stored
    confirmation (`check_loop_confirmed_at`);
  - `checkRounds` in the project's watch settings.
- **A far client can no longer change the watch's checks or their timeout.** This is a
  tightening of phase 22, and it appears in the release notes.
- **The watch's own checks also get the allowlisted environment, the stricter command check, the
  4 MB output bound and the mask-before-cut order.** They run through the same shared code, a
  second tightening of phase 22 for the release notes. A project whose checks need more
  variables lists them in `checkEnv`. This is tested on Windows by hand (#14), since Windows does
  not gate a PR.
- **Outside `bypassPermissions`, the loop is a deliberate exception to the session's permission
  mode,** which the person accepts when turning it on. Where that is unacceptable, the option
  stays off.
- **The checks run after every turn of a looping card:** on a slow suite, minutes per round. N
  and the timeout bound the cost, and the person sees each round.
- **The board slices, in order:**
  1. **Daemon.** The loop, the table, the abort signal on the runner, the slot hold, and the
     near-only checks patch. The security-reviewer reads this slice before its push.
  2. **Protocol.** `Card.checkLoop`, the card option on `card.update` (with `confirm` outside
     `bypassPermissions`), `checkRounds` and `checkEnv`, and the refusal reasons
     `check_loop_no_checks`, `check_loop_untrusted`, `check_loop_confirm` and `check_word_outside`.
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

The PR's review then added more, all folded in above:
- the permission mode is read again before every round, with a stored confirmation, and a
  project default applies only to cards in `bypassPermissions`;
- the runner masks before its cut;
- the fence is longer than any backtick run in the output;
- a 4 MB output bound;
- a message or an interrupt from the person aborts the loop, and resets the counter;
- the slot hold is decided at the idle event;
- the Windows environment list, and `checkEnv`;
- the path rule on every word, with drive letters, UNC and `ntfsName`.

The reviewer judged the kill model (process group, `taskkill /T`), one check per card, and no
resume after a restart to be sound. The daemon slice is reviewed again as code before its push.
