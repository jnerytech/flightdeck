# A plain session's changes are committed in the person's own checkout, with their hooks (issue #1133)

## Context

#1133 finishes a hand-started session from its Changes tab: "Commit on a new branch", then "Open PR".
It asks to reuse the commit step of the Claude Code setup (#1080, `harness/commit.ts`), and says
"nothing of the person's moves without a confirm; no hook bypass". The #1080 step commits through a
temporary index, with every hook, fsmonitor and gpg of the repository turned off, and moves no
branch of the checkout.

## Decision

- **A normal commit in the checkout.**
  - The checkout switches to the new branch (`git switch -c`), adds the chosen new files, and commits
    them with `git commit -- <paths>`.
  - The person's hooks run as they would for their own commit. There is never a `--no-verify`.
  - The checkout ends on the new branch with those files committed. The files not chosen stay as
    they were.
- **Only what the person saw.**
  - `changes.get` gives each uncommitted file of a session a `digest`: the sha256 of its bytes now,
    or `deleted`.
  - `changes.commit` takes back `{path: digest}`. A file that moved since the person saw it, or one
    that is not uncommitted any more, refuses with `changes_commit_stale`.
  - A file that may hold a credential (`.env`, #509) has no digest and is never read. It refuses with
    `changes_commit_secret`.
- **Refused before anything moves.**
  - A target that is not a plain session, or a root that is a card's worktree
    (`changes_commit_target`).
  - A merge, rebase, cherry-pick or revert in progress, or staged files the person did not pick
    (`changes_commit_state`, with `state`).
  - A secret in the message (`changes_commit_message_secret`) or in a chosen file's content
    (`changes_commit_secret`), checked by the host scanner, or a file over 8 MiB, too large to
    check (`changes_commit_too_large`).
  - A branch name that `git check-ref-format` refuses (`branch_invalid`), or one already there
    (`changes_commit_branch_taken`).
- **A failing hook.**
  - The person stays on the new branch, with their files untouched and their index put back from a
    copy taken before.
  - The refusal `changes_commit_hook` carries the end of what git and the hook said (2,000
    characters at most, withheld when the scanner flags it), the branch, and the base to switch back
    to.
- **Git as the person runs it.**
  - `GIT_TERMINAL_PROMPT=0`, so no credential prompt waits.
  - `GIT_LITERAL_PATHSPECS=1`, so a path is never a pattern.
  - Every call has a time limit (120 s), which stops a hook or a gpg prompt that never ends.
  - The message goes on stdin, and paths follow `--`.
- **Guards.** A near connection only, and `confirm: true` (`changes_commit_confirm`).
- **The base.** The branch the checkout was on is kept, by checkout and branch, for the PR step (D2).

## Alternatives discarded

- **#1080's temporary index.** The checkout would stay on its old branch with the same edits still
  uncommitted. End would warn about changes already in the PR, and the next session would take them
  again. It also turns hooks off, which #1133 rules out.
- **Taking the file list without digests.** A session still running can change a file between the
  look and the confirm, and the commit would hold text the person never saw.
- **Putting the person back on their branch after a failing hook.** That is what they asked not to
  happen. They fix what the hook said and commit again, or switch back with the base the refusal
  names.

## Consequences

- The daemon runs the repository's hooks, which are code from the project. It does so only on a
  confirmed request from a near connection, and they are the same hooks the person's own `git commit`
  would run.
- After a failed hook, the new branch stays there with no commit of its own. A retry needs another
  name, and the app (slice A) drafts a new one.
