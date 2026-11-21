# Reading worktrees, issues and PR comments from a shell (issue #3702)

Slice 1 of #3702: `worktree list`, `issues list`, `issues get` and `card pr-comments`, over `worktree.list`, `issues.list`,
`issues.get` and `pr.comments`. `worktree remove`, `issues create-card` and `card pr-comments-send` are the second slice;
the `worktree` and `issues` nouns join `VERB_NOUNS` with the `worktree remove` risk rule there, since no verb of this
slice needs a rating.

- All four verbs only read, so a call with no answer exits 2 and says nothing about a write.
- `worktree list` without a project sends `{}` and never asks for the project list. The size of a worktree is `null` while
  the scan is unfinished, in `--json` and as `size unknown` in text: it is never printed as 0.
- Text that comes from outside is cleaned by the printer (`plain`), as in the other commands: an issue or a comment
  cannot send an escape sequence to the terminal. An issue from outside the team (`external`) and a PR comment whose
  GitHub `author_association` is not owner, member or collaborator are flagged `EXTERNAL`, with the reminder that their
  text is data. The rule is `isExternalComment` of the github domain, next to `TRUSTED_ASSOCIATIONS`, and the watch uses it too.
  Azure DevOps comments carry an identity and no association, and are not flagged (as in the app).
- `card pr-comments` runs on this machine's daemon only: `card` is not in `HOST_COMMANDS`, and giving it `--host` for one
  verb would mean a host-aware `card` runner for every other verb. Left for a later slice.
- The parity file maps `worktree.list`, `issues.list`, `issues.get` and `pr.comments`; the baseline drops by four.
