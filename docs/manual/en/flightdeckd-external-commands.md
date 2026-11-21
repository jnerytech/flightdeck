# flightdeckd commands: terminal sessions and names

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-external-commands.md)

The verbs that list the sessions of a plain `claude` running in a terminal on a host, watch them change, put a message into
one and list the names the host gives its sessions. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). `--host <name>`, `--json` and `--config` work on each of them.

## fd external

```sh
fd external list
fd external list --json
fd external watch
fd external watch --json --host pi
fd external message <claude-session-id> --text "go on"
```

`list` prints how many sessions the host sees, then one line for each: the Claude session id, its name, how it stands
(with the reason, such as the tool it waits for), whether it takes a message, its folder and the time of its last event.
With `--json` it prints a list with the same keys for every session: `claudeSessionId`, `name`, `cwd`, `status`,
`statusReason`, `controllable`, `source`, `projectKey`, `permissionMode`, `waiting`, `startedAt`, `lastEventAt` and
`endedAt`, with `null` for what is missing. The path of its transcript, its launch id, its last prompt and its plan
text are not printed: read them in the app.

`watch` prints one line for each session the host reports (all of them when it starts, then each change), until you
press Ctrl-C, which ends it with exit `0`. With `--json` each line is one JSON row, the same as `list` prints.

`message` puts the text into the session, as the input box of the app does. Only a session opened with
`flightdeckd claude` has the channel for it: any other is refused with exit `1`, and so is a session the host does not
know. An empty text is refused before the command connects. It prints `sent to <id>`; with `--json` it prints `session`
and `delivered`. If the host is cut off after the text left, the exit is `2` and the text may or may not have gone in:
look at the session before you send it again.

## fd names

```sh
fd names list
fd names list --json
```

Prints one line for each session of the host: the alias you can type, the name the app shows, the session it names and,
when there are more, the other aliases (`also ...`). With `--json` it prints every key of the name (`sessionId`,
`display`, `alias`, `aliases`, `project`, `persona`, `number`, `cardNumber`, `standard` and `team`), with `null` for what
an older host leaves out. It changes nothing.
