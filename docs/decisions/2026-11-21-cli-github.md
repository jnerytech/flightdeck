# GitHub status, repositories and issues, and the Claude account from a shell (issue #3703)

`github status|repos|issues` and `account get|refresh|watch`, over `github.status`, `github.repos`, `github.issues`,
`account.get`, `account.refresh` and `account.watch`. This is the read side of #3703; the login, logout and start
verbs are a second change.

- `github status --json` prints the five keys of the answer (`installed`, `loggedIn`, `login`, `scopes`, `source`) and
  nothing else, so a field the daemon adds later never reaches a script by accident; no path of these commands handles
  a token.
- `github issues` prints the lines of `issues list` and flags an issue from outside the team the same way. The line
  printer is repeated in the github domain, not imported from `issues`, because `issues` already imports `github` and
  two domains may not import each other.
- `--query` is a flag of `github repos` only and takes 1 to 100 characters, the protocol's own limit. The repository of
  `github issues` is not checked while parsing: the daemon owns what a repository name looks like.
- `account watch` is a read, so a lost connection is exit `2` with no "may or may not" text, and Ctrl-C ends it with
  `0`. A signed-out host prints the command to run on that host and never runs it: the app shows it the same way.
- The risk rules need no new rule: the reads stay ordinary. The write verbs of the second change are the ones that
  add one.
- The parity table rows of the seven commands (`account.get|refresh|watch|unwatch`, `github.status|repos|issues`) moved
  from `{}` to their noun; `account.unwatch` maps to `account` as `changes.unwatch` maps to `changes`.
