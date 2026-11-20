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
reads a paired host. These verbs only read; the ones that act on a session follow.

```sh
fd session interrupt fd-qa
fd session close fd-qa
fd session resume fd-qa
fd session sleep fd-qa
fd session set-model fd-qa opus
fd session set-effort fd-qa high
fd session meta set fd-qa name=Review pinned=true
```

Acts on one session, as the buttons of the app do. `interrupt` stops the turn it is running, `close` ends it
and `resume` starts an ended one again. `sleep` puts an idle session to sleep: it exits `0` when the session
sleeps (or already did) and `1`, with the reason, when the daemon keeps it awake because it is busy, has a
message waiting, has a reason to stay up or someone is watching it. `set-model <session> <model>` and
`set-effort <session> <low|medium|high|xhigh|max>` change the model or the effort of the next turns; the word
`default` gives the session's own back. `meta set <session>` takes `name=<text>`, `pinned=true|false` and
`archived=true|false` (at least one); `name=` alone clears the name, and a session that has no Claude session
yet is refused. A name two sessions share is refused with the ids. If the daemon does not answer, the command
exits `2` and says the change may or may not have gone in: look at the session before you repeat it. With
`--json` each prints `{"session": ..., "action": ...}` plus the new value. `--host <name>` reaches a paired
host.

```sh
fd session create --cwd ~/repos/app --prompt "fix the build" --permission-mode plan
fd session fork 7c1e... --cwd ~/repos/app --up-to 3f9a... --open terminal
fd session set-mode fd-qa plan
fd session apply-persona fd-qa reviewer --language en
fd session clear-persona fd-qa
```

Starts or reshapes a session. `create` starts a new session in `--cwd` (a folder under an allowed root, or the
daemon refuses it) and prints its id; `--prompt`, `--name`, `--model`, `--effort`, `--permission-mode` and
`--persona` (with `--language`) are the fields of the new-session form. `fork` starts a copy of a Claude session,
up to `--up-to <message id>` when given: `--open flightdeck` (the default) starts it as a session of the daemon,
and `--open terminal` prints the command that opens it (`flightdeckd claude --resume <id>`) without opening
anything. `set-mode <session> <default|acceptEdits|plan|bypassPermissions>` changes what a live session may do
without asking; a host that does not allow `bypassPermissions` refuses it. `apply-persona` gives a session a
persona and `clear-persona` takes it away; each sends the session a message and says whether it went in, waits for
the turn or went to a terminal session. `create`, `fork`, `set-mode` and `apply-persona` are rated high-risk when a
session runs them from its own shell, so its permission prompt asks the person. If the daemon does not answer,
`create` and `fork` say a session may or may not have been started: run `fd sessions` before you repeat them.

