# Watching and fixing a PR

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/watching-and-fixing-a-pr.md)

A card with an open PR has **Watch and fix**. It is off by default: turn it on in the card, or make
it the default of a project in **Settings**. Hosts that offer it (`watch` in the host page) watch
the PR at every `board.prPollIntervalMs`:

- the **builds** and the **policy evaluations** (Azure DevOps, through `az devops invoke`; GitHub,
  through `gh pr checks`), the **conflicts** with the target branch and the **new comments** of
  people you trust (the card's identity, or owners, members and collaborators);
- only what **got worse** starts a round: a build that fails, a new conflict, a new comment. The
  first look counts everything as new.

A **round** opens the card's session as the `revisor` persona, with the names of the failed checks,
the end of the build log (16 KB), the conflict and the comments. The log and the comments reach it
as quoted data, never as instructions. The session fixes and commits, the **local checks** of the
project run in the card's worktree, and only if they all pass does the host push, to the card's own
branch, never forced and never to the base. Merging stays with you. The card shows **Watching the
PR**, each round with its result (**Round 2 · failed**) and why it asks for you.

A round stops, and the card goes to **Needs you** with the summary, when a limit is reached: 3
rounds per PR, US$ 5 per PR, 30 turns, US$ 20 per day and project, two failed rounds in a row, or
the quota queue. It also stops by itself when the PR is merged or closed, or when you turn the
watch off. **Watch again** puts it back.

The card shows **Fix rounds used: 2 of 3**. When the rounds run out, **Allow 2 more rounds** gives the
card two more without forgetting what it spent; the host refuses it when another limit (turns, cost,
the card's branch) would stop the next round anyway. While a card's PR is watched, an automation that
sends failed checks or review comments to the card leaves it to the watch.

Before it pushes, the host checks that the round stayed inside the PR: a round that touches a file
the PR does not change (and that no review comment names), or that changes more lines than
`max(200, the PR's)`, is **held for you** instead of pushed. The round lists the files outside the PR
and the lines it changed. **Push anyway** pushes those commits as they are; **Drop the round** takes
them back, keeping what was there before the round. Lockfiles and `*.snap` never count.

**Settings** has **Watch and fix PRs · <host>**, one block per project: watch by default, rounds per
PR, cost limit per PR and per day (empty is no limit), the time limit per check (1 to 60 minutes,
10 by default) and the **local checks**, one per line. A check is a command with its arguments, with
no quotes, pipes, `;`, `&`, `$` or redirections: anything else is refused. A check that runs out of
time is killed with everything it started, and the round says so. A pushed round lists the checks
that passed.

Two more things come with it:

- **Open PR** on a card first shows the **PR description**, made from the card's sessions, to edit.
  Lines that look like a secret are taken out and counted. Nothing is opened until you click **Open
  the PR with this text**. The **PR title** starts from the card's title; the title and the description each have
  the wand, which writes from the card's repository.
- **Ctrl+K**: paste a PR link (Azure DevOps or GitHub) and choose **Open the PR from the link**. The
  hosts are asked: the card opens if the PR is from one; otherwise the transcript of the first
  session the history knows for it; otherwise a message says nothing has it.
