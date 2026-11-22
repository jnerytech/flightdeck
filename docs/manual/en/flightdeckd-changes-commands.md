# flightdeckd commands: the changes of a session, a card, a terminal or a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-changes-commands.md)

The verbs that read what a session, a card, a terminal or a project changed in its checkout, and the ones that revert a file, commit and open a pull request. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). The reads change
nothing. The writes need `--confirm`.

## fd changes

```sh
fd changes get session:3f9c1a
fd changes get card:card-1 --json
fd changes sessions /home/me/api/src/parser.ts
fd changes watch card:card-1
```

A target is `session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`; anything else is refused with exit `1`
before the daemon is asked.

`get <target>` prints where the changes are (the top folder of the checkout), the branch they are compared with and,
for a card, how many commits it is ahead of and behind it, the address a pull request would be pushed to, the commit
hooks a commit would run, and then one line for each changed file: its status, its counts, whether it is not
committed yet, and the digest of its content. A file that may hold a credential, and a file over the daemon's size
cap, are listed with no lines and no counts, as in the app. No change prints `no changes`.

`sessions <file>` takes the absolute path of a file and prints the sessions that wrote it: how many edits each made,
when the first and the last were, and the title of the session.

`watch <target>` prints the same list of `get`, as one line, each time the changes move, until Ctrl-C.

With `--json` the commands print the value the daemon returns, with `null` for a missing field and the lines of every
diff for `get` and `watch`. `--host <name>` reads a paired host.

## Reverting, committing and opening a pull request

```sh
fd changes revert session:3f9c1a /home/me/api/src/parser.ts --confirm
fd changes undo-revert session:3f9c1a /home/me/api/src/parser.ts --confirm
fd changes commit session:3f9c1a --branch fix-parser --message "Fix the parser" --digest src/parser.ts=9a1f... --confirm
fd changes pr session:3f9c1a --title "Fix the parser" --remote git@github.com:me/api.git --confirm
```

Every one of these needs `--confirm`; without it the command is refused with exit `1` and nothing changes.

`revert <target> <file>` discards the changes of one file. It prints the command that takes it back and until when:
`undo-revert <target> <file>` puts the file back while the daemon still keeps it. Both need a near connection (this computer or Tailscale) when the file steers a session (inside any `.claude` folder, or a `CLAUDE.md` or `CLAUDE.local.md`, however the path is spelled or linked), since it can declare hooks that run in every session: over a far one the daemon refuses with `transport_refused`. Any other file answers anywhere.

`commit <target>` commits the files you name on a new branch. Each `--digest <path>=<digest>` is the digest `get`
printed for that file, so the commit holds what you read: a file that changed since is refused. It prints the commit,
the branch and the files.

`pr <target>` pushes the branch to the address `get` printed as the remote, and opens a pull request with the title
and, if you give one, the body. It prints the address of the pull request. A host reached by an address that cannot
reach the vault refuses `commit` and `pr` with exit `1`.

If the connection is cut after the request left, the command says the change may or may not have happened and exits
`2`: run `get` before you try again.

A session's own shell cannot run `commit`, `pr` or `revert` without the person approving it in the app.
