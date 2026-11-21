# flightdeckd commands: the run environment of a card

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-runenv-commands.md)

The verbs that read a project's `run.yaml` and the processes a card runs from it. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). They change
nothing. Trusting a file, and starting or stopping a card's processes, stay in the app.

## fd runenv

```sh
fd runenv config api
fd runenv config api --json
fd runenv get card-1
fd runenv watch
```

`config <project>` prints the `run.yaml` of a project, named by its name or its id: its hash, whether it is trusted,
each error in it, and then what it would run: the ports, the setup commands and one line for each process with its
command, its ready check and the names of the variables it sets (never their values). A project with no file prints
`no run.yaml` and exits `0`. A name that two projects share is refused with their ids.

`get <card>` prints the run of a card: its state and the state of its setup, its ports, and one line for each
process with the terminal it runs in, whether it is running, whether it is ready and its link. A card the host does
not know is refused with exit `1`.

`watch` prints the run of each card each time it changes, one line each, until Ctrl-C.

With `--json` the commands print the value the daemon returns, with `null` for a missing field. `--host <name>` reads
a paired host.
