# flightdeckd commands: the snapshots and the trace of a Claude session

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-checkpoints-commands.md)

The verbs that read the git snapshots Flightdeck takes around each turn of a Claude session, what rewinding to one
would change, and the trace of the session: its turns, tool calls and subagents with their time and cost. They work
as the other `flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). All of
them only read: nothing here rewinds a session or changes a file. They take `--host <name>` to read a paired host and
`--json` to print the value the daemon returns.

`<session>` is the Claude session id, the one the history commands print. A session the daemon does not know is
refused with exit `1`.

## fd snapshots

```sh
fd snapshots list 3f9c1a
fd snapshots files 3f9c1a 2
fd snapshots files 3f9c1a 2 --json
```

`list <session>` prints one line for each snapshot: its number, its kind (`before`, `after` or `safety`), when it was
taken and the prompt of the turn when it has one. The number is the turn the other verbs take. A session with none
prints `no snapshots`. With `--json` it prints the number, kind, turn id, prompt and time of each snapshot, with
`null` for a missing prompt; the repository path and the git reference stay with the daemon.

`files <session> <turn>` prints how many files that turn changed and the lines added and removed, then one line for
each file with how it changed. A turn that changed nothing prints `no file changed`. The turn is a whole number from
`0`; anything else is refused with exit `1` before the daemon is asked.

## fd rewind

```sh
fd rewind preview 3f9c1a 2
```

`preview <session> <turn>` says what rewinding the session to that turn would change, and whether the daemon would do
it through the SDK's checkpoint or through a snapshot: the files, and the lines added and removed. It changes nothing.

## fd trace

```sh
fd trace get 3f9c1a
fd trace export 3f9c1a > trace.json
fd trace export 3f9c1a --include-content > trace.json
```

`get <session>` prints the cost and duration of the session, the turn or subagent that cost most and the call that
took longest, then the tree: one line for each turn, tool call, subagent and thought, with its time, its cost and
`error` when it failed. The text of the prompts of the turns is cut to a line; `--json` prints the whole trace the
daemon built, tool inputs and results included.

`export <session>` prints the trace as JSON on standard output, the file the app's export would save, so a shell
redirects it where it wants. The file holds the structure and the numbers; `--include-content` adds the prompts and
the tool inputs and results, with any field that held a secret replaced. When the daemon replaced some, the command
says how many on standard error, never in the file. With `--json` it prints the file's name, its text and that count
as one value.
