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
- **The bytes checked are the bytes committed.**
  - Each chosen file is read once, through a handle that does not follow a link: those bytes are
    hashed against the digest the person saw, and scanned. A link is its text.
  - After the commit, git hashes the same bytes with the path's own filters, and the commit must
    hold exactly those. A session still writing may change a file between the check and git's read.
    If one did, the commit is undone (the branch back on the commit it started from, the index as
    it was), and the refusal `changes_commit_rewritten` names the files. A hook that formats files
    does this too: the person looks at the formatted change and commits again, and the hook,
    finding nothing left to format, lets it through.
  - A rename's old path goes into the commit as gone. It must be absent when it is checked, and the
    commit must not hold it.
  - A chosen path that is no longer a regular file (a pipe, a device) is refused as stale, never
    opened: opening a pipe with no writer never returns.
  - A file over 8 MiB gets the digest `too-large` without being read, so a refresh of the diff never
    hashes a large artifact, and choosing it refuses at once.
- **One at a time.** Commits of one checkout run one after the other. A second one (a double click,
  two windows) then finds its files committed and refuses as stale.
- **The hooks that will run are shown.** For a session, `changes.get` names the hooks a commit from
  the app runs: `pre-commit`, `prepare-commit-msg`, `commit-msg` and `post-commit`, plus
  `post-checkout`, `reference-transaction` and `post-index-change`, which the switch to the new
  branch, the ref update and the index write run. It takes them
  from the folder `git rev-parse --git-path hooks` gives, which accounts for `core.hooksPath` and
  for a linked worktree. The app shows them in the confirm (slice A), together with a line saying
  that other programs the repository's settings name may run too.
  - The list is read when the person looks, not pinned: a hook can change before the commit.
  - When git cannot say where the hooks are, the field is absent, and the app says they are
    unknown, never "none".
- **A failing hook.**
  - The person stays on the new branch, with their files untouched and their index put back from a
    copy taken before.
  - The refusal `changes_commit_hook` carries the end of what git and the hook said (2,000
    characters at most), the branch, and the way back: the base branch, or from a detached checkout
    the commit it was on. Both work with `git checkout`. The output is scanned whole
    before it is cut, so a cut cannot split a secret past the scanner, and it is withheld when the
    scanner flags it.
  - The index is put back through a new file renamed into place, so a link left where the index was
    is replaced, not followed.
- **Git as the person runs it.**
  - `GIT_TERMINAL_PROMPT=0`, so no credential prompt waits.
  - `GIT_LITERAL_PATHSPECS=1`, so a path is never a pattern. The hooks inherit it, which changes how
    a hook's own git commands read patterns; that is the price of literal paths.
  - Every call has a time limit (120 s), which stops a hook or a gpg prompt that never ends; that
    refusal is `changes_commit_timeout`, and an output withheld for a secret is
    `changes_commit_hook_withheld`.
  - The message goes on stdin, and paths follow `--`.
- **Guards.** A near connection only, and `confirm: true` (`changes_commit_confirm`).
- **The base.** The branch the checkout was on is kept, by checkout and branch, for the PR step (D2).
  It is kept in memory only: after a restart, the PR step falls back to the remote's default branch.

## The PR (slice D2)

- `changes.pr {target, title, body, remote, confirm}` pushes the session's current branch to `origin` with
  its upstream and opens its PR, near only and confirmed (`changes_pr_confirm`).
- One core does this for a card and a session (`board/publish-pr.ts`). The title and body are
  scanned (`pr_secret`, `pr_title_secret`), then the branch is pushed, then the provider opens the
  PR. A card's base is now checked before its push, not after.
- **Only the daemon's own branch.** A PR opens only for a branch a commit from the app made, into
  the branch that commit started from (kept in memory). Any other branch refuses
  (`changes_pr_base`): one made by hand, one after a restart, or the base itself. The remote's
  default (`origin/HEAD`) never stands in, since the session can point it anywhere.
- **Only the commit the app made.** The commit's id is kept with its base. A branch whose tip is no
  longer that commit refuses (`changes_pr_moved`): the session added to it, reset it, or remade it.
  The push sends that commit by its id, so a branch moved during the push changes nothing.
- **Nothing unseen goes along.** A commit pushed by its id takes every ancestor `origin` lacks. When
  the base has commits that are not on `origin` (`rev-list <commit> --not --remotes=origin` lists
  more than the app's commit), it refuses (`changes_pr_ahead`).
- **Where the push goes.** `changes.get` shows `origin`'s push address as git resolves it
  (`pushurl` and `pushInsteadOf` included), with any user, password, query and fragment taken out.
  The confirm sends it back, and an address changed since refuses (`changes_pr_remote`). A failed
  push's message goes through the same cut, since git quotes the address (it keeps a query).
- **The push.** It names the whole ref (`<commit>:refs/heads/<b>`), so no `push.default`, upstream
  or refspec setting redirects it. `--no-recurse-submodules --no-follow-tags` keep a submodule or a
  tag the person never saw from going along. The upstream is set after the push.
- **A failed push.** Past its limit (10 min, for a card's first push of a large branch too) it says
  so (`pr_push_timeout`). Otherwise its output is cut to the address rule above, then scanned with
  the host's vault: a match withholds it (`pr_push_withheld`), else at most 2000 characters show.
  A card's Open PR gets the same. It has a time limit (120 s) and no
  prompt (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`). The `pre-push` hook runs, as it would
  for the person's own push, and `changes.get` names it with the commit's hooks.
- **Content.** Only the title and description are scanned at this step. The content was scanned
  when the commit from the app was made, and only such a branch is pushed.
- **Never the base.** A checkout on its base (`changes_pr_on_base`) or on no branch
  (`changes_pr_detached`) refuses, so the base itself is never pushed.
- **The provider.** It is the board project's that holds the checkout, else GitHub (`gh`). A project
  set to none refuses (`project_no_pr_provider`).
- A card's target or worktree refuses (`changes_pr_target`): a card has its own Open PR.

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
- A session can write `.git/hooks`, `core.hooksPath` or `.git/config` itself: a hook, a filter,
  `core.fsmonitor`, `core.sshCommand`, an include. These run as the daemon's user, outside the
  session's own permissions, exactly as they would for the person's own next `git commit` in
  that checkout. Flightdeck shows the hooks that will run. It does not claim to detect a planted
  hook or setting.
- **A check of what changed since the session started was tried and dropped.**
  - It compared file times, which `touch` resets.
  - It read neither config includes, nor worktree config, nor a linked worktree's common folder.
  - Its list of settings that run programs was a deny-list, which a new setting passes unseen.
  - A check that cannot hold reads as a guarantee, which is worse than an honest notice.
- **Accepted for the push (low).** The address check and the push are two git runs: a session that
  changes `origin` between them pushes elsewhere. The comparison also ignores a user in the
  address. Pinning the push to the checked address would put its credentials on the command line,
  and the same session can already push anything as the same user. `core.sshCommand` and
  `credential.helper` run at the push, as for the person's own `git push`, and the hook notice
  above covers them. `remote.origin.receivepack` and `core.hooksPath` belong to the same class of
  session-writable settings and are not listed one by one.
- When the provider fails after the push, the branch stays on `origin`. A retry pushes the same
  commit again, which changes nothing, and opens the PR.
- After a failed hook, the new branch stays there with no commit of its own. A retry needs another
  name, and the app (slice A) drafts a new one.
