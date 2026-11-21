# flightdeckd commands: the changes of a session, a card, a terminal or a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-changes-commands.md)

The verbs that read what a session, a card, a terminal or a project changed in its checkout. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). They change
nothing. Reverting a file, committing and opening a pull request stay in the app for now.

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
