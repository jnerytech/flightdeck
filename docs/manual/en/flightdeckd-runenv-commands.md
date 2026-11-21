# flightdeckd commands: the run environment of a card

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-runenv-commands.md)

The verbs that read a project's `run.yaml` and the processes a card runs from it, and the three that trust the file,
start those processes and stop them. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). `config`, `get` and `watch` change nothing.

## fd runenv

```sh
fd runenv config api
fd runenv config api --json
fd runenv get card-1
fd runenv watch
fd runenv trust api --hash 9f3a1c4e7b2d5a60 --confirm
fd runenv start card-1 --confirm
fd runenv stop card-1
```

`config <project>` prints the `run.yaml` of a project, named by its name or its id: its hash, whether it is trusted,
each error in it, and then what it would run: the ports, the setup commands and one line for each process with its
command, its ready check and the names of the variables it sets (never their values). A project with no file prints
`no run.yaml` and exits `0`. A name that two projects share is refused with their ids.

`get <card>` prints the run of a card: its state and the state of its setup, its ports, and one line for each
process with the terminal it runs in, whether it is running, whether it is ready and its link. A card the host does
not know is refused with exit `1`.

`watch` prints the run of each card each time it changes, one line each, until Ctrl-C.

`trust <project> --hash <hash> --confirm` lets the host run the commands of the project's `run.yaml`. Pass the hash
`config` printed after you read the file: if the file changed since, the host refuses and nothing is trusted. It
prints the file as `config` does. `start <card> --confirm` runs the setup and the processes of the card, and prints
its run as `get` does. Both need `--confirm`, because they make the host run commands. `stop <card>` ends them
and needs nothing. A session that runs `trust` or `start` from its own shell for you is stopped at the permission
prompt as a high-risk command: you answer it in the app. If the host does not answer after one of the three was
sent, the command exits `2` and says to check with `runenv config` (for `trust`) or `runenv get` before trying
again.

With `--json` the commands print the value the daemon returns, with `null` for a missing field; for `config` that
includes the values of the variables a process sets (and `watch --json` prints them on every update), so keep that
output out of shared logs. The text prints each command whole: a secret belongs in a variable, not in a command line. `--host <name>` reads
a paired host.
