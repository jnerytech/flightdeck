# flightdeckd commands: the background sessions of a host

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-bg-commands.md)

The verbs that list and control the background sessions of a host: the sessions Claude Code runs with `claude --bg`,
with no terminal attached. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). They take `--host <name>` to run on a paired host,
and `--json` to print the value the daemon returns.

## fd bg

```sh
fd bg list
fd bg list --json
fd bg list --host pi
```

`list` prints how many background sessions the host has, then one line for each: its id, its state (`working`,
`blocked`, `done`, `failed` or `stopped`), while its process is alive whether it is `busy`, `waiting` or `idle`, what a
waiting session waits for (`permission prompt`, `input needed`), its name (its folder when it has none) and what it
cost so far. It changes nothing.

```text
2 background sessions
  ab12 working (busy) fix the parser $0.42
  cd34 blocked (waiting), waiting for permission prompt /work/web
```

A host with none prints `no background sessions`. A host whose `claude` is too old to have them prints
`this host's claude has no background sessions` and exits `0`: it is a fact about the host, not a failure.

With `--json` it prints `supported` and the list of sessions, each with `id`, `name`, `cwd`, `state`, `status`,
`waitingFor`, `pid`, `claudeSessionId`, `startedAt` (Unix milliseconds) and `costUsd`, and `null` where the daemon has
no value. When `supported` is `false` the list is empty.

```sh
fd bg start --cwd /work/api --prompt "fix the parser" --name parser
fd bg start --card 9f2c --persona fd-developer
fd bg stop ab12
fd bg respawn ab12
fd bg message ab12 --text "use the second approach"
```

`start` runs a new background session and prints its id. Give it a folder and a prompt, or a card (its project's folder
and its text), never both; `--name` (up to 120 characters) and `--persona` are optional. The daemon runs it only in a
folder it allows, and a folder it does not trust runs without the project's hooks and servers. `stop` ends a session,
`respawn` starts a stopped one again in its folder, and `message` writes the text (up to 32000 characters) into one. A
session that is running and has no channel to write into is refused with its reason: only a session started with
`flightdeckd claude`, or a stopped one, takes a message. Writing into a stopped session resumes it with that text.

Each prints one line (`started background session ef56`, `stopped ab12`, `respawned ab12`, `sent a message to ab12`),
and with `--json` the id of the new session, or the sessions the daemon lists afterwards. A refusal of the daemon
(background is off, a folder it does not allow, an unknown card) is exit `1` with its message. The commands that change
a session wait up to a minute for `claude`; if the daemon does not answer in that time the exit is `2`, and the
command may or may not have run: look with `fd bg list` before you run it again.

From the shell of a session of Flightdeck itself the four writes are high risk and wait for the person in the app,
since a typed command is not the person: only `fd bg list` runs on its own.
