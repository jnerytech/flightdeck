# GitHub status, repositories and issues, and the Claude account from a shell (issue #3703)

`github status|repos|issues` and `account get|refresh|watch`, over `github.status`, `github.repos`, `github.issues`,
`account.get`, `account.refresh` and `account.watch`. The first change is the read side of #3703; the login, logout and
start verbs are the second one, described at the end.

- `github status --json` prints the five keys of the answer (`installed`, `loggedIn`, `login`, `scopes`, `source`) and
  nothing else, so a field the daemon adds later never reaches a script by accident; no path of these commands handles
  a token.
- `github issues` prints the lines of `issues list` and flags an issue from outside the team the same way. The line
  printer is repeated in the github domain, not imported from `issues`, because `issues` already imports `github` and
  two domains may not import each other.
- `--query` is a flag of `github repos` only and takes 1 to 100 characters, the protocol's own limit. The repository of
  `github issues` is not checked while parsing: the daemon owns what a repository name looks like.
- `account watch` prints the current state (an `account.get` after the watch is acknowledged) before the pushes, since
  the host pushes nothing until its next read when the app already watches. The default timeout is 45 s, above the
  host's two reads of up to 20 s each, so a slow `claude` is not reported as no daemon.
- `account watch` is a read, so a lost connection is exit `2` with no "may or may not" text, and Ctrl-C ends it with
  `0`. A signed-out host prints the command to run on that host and never runs it: the app shows it the same way.
- The risk rules need no new rule for the reads: they stay ordinary.
- The parity table rows of the seven commands (`account.get|refresh|watch|unwatch`, `github.status|repos|issues`) moved
  from `{}` to their noun; `account.unwatch` maps to `account` as `changes.unwatch` maps to `changes`.

## The write verbs: login, logout and start

- `github login` prints the one-time code and the page and returns at once; it opens no browser and waits for no
  result, so a script or a person types the code and then looks with `github status`. `--cancel` ends the sign-in.
  Neither prints or reads a token: the daemon's `gh auth login` flow keeps it.
- `github logout` needs `--confirm` while parsing, as the other destructive verbs do. A login that comes from the
  daemon's environment is the daemon's refusal, not a case the command handles.
- `github start` needs the repository (`owner/name`, checked while parsing, since the daemon would clone a wrong name
  into a folder), `--root` and `--mode card|session`; `--issue` is a whole number from 1 and travels as the string the
  protocol takes. The command waits up to 330 s, a little over the clone's own limit; `login` waits 45 s.
- A write that loses its answer exits 2 and says "may or may not", with the command that finds out: `github login
  --cancel` or `github status`, `github status`, and `project list`.
- `--root`, `--mode`, `--issue`, `--cancel` and `--confirm` are flags other commands also own (`project clone`, `file
  search`, and the confirmations). Each is refused on a verb that does not take it, and on `account`, by naming the verb
  that does, so a typo is not silently ignored.
- Risk: `login`, `logout` and `start` are high from a session's shell with the same wording as the app's own steps:
  the sign-in's code is typed by a person, a logout ends every feature that reads the host's repositories, and a start
  clones into the host and runs a session on an issue's text, which anyone can write. A typed `--confirm` is not the
  person. The reads stay ordinary. The parity rows of `github.login.start`, `github.login.cancel`, `github.logout` and
  `github.start` moved from `{}` to `github`.
