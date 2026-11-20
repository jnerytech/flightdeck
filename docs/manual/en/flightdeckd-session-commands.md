# flightdeckd commands: one session

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-session-commands.md)

The verbs that read or act on one session of the daemon. They work as the other `flightdeckd` commands
do: see [what they all share](flightdeckd-commands.md#what-they-all-share). `fd sessions` lists the
sessions; `fd send` sends one a message.

## fd session

```sh
fd session interrupted
fd session summary fd-qa
fd session files fd-qa --json
```

Reads one session of the daemon. `interrupted` lists the sessions a daemon restart interrupted in the last
24 hours, one line each: name, folder, how long it had run, when it was interrupted and the last thing you
asked it. `summary <session>` prints what the session was asked, what it did, the files it touched, what it
cost and its state, from the transcript (no model call). `files <session>` lists the files it edited with the
number of edits and the last edit. The session is its name or its id; a name two sessions share is refused
with the ids, and a session that has no Claude session yet has nothing to read. With `--json` each verb
prints what the daemon returned: `{"sessions": [...]}`, the recap, or `{"files": [...]}`. `--host <name>`
reads a paired host. These verbs only read; the ones that act on a session come in a later slice.
