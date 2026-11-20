# flightdeckd commands: host, sessions, requests, approve and send

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-commands.md)

Every `flightdeckd` command that asks the daemon of this machine works the same way. Below, `fd` is
the short name of `flightdeckd`: `flightdeckd setup` installs it (see
[flightdeckd claude and the channel](flightdeckd-claude-and-the-channel.md)), and `flightdeckd`
works in its place everywhere.

## What they all share

- **`--json`:** prints one JSON value and nothing else, for a script. A fact the daemon does not
  report is `null` (or an empty list), never missing.
- **Exit codes:** `0` done, `1` refused, `2` no daemon (not running, cut off, or too slow).
- **This machine, by default:** the command reads the token from the daemon config file and talks
  only to `127.0.0.1` or `::1`. `--token` is refused.
- **Another host, with `--host <name>`:** `fd host`, `fd sessions`, `fd requests`, `fd send`,
  `fd approve` and `fd deny` take the name of a host paired in the app. The command asks that
  host's daemon with the token the app keeps in the system credential store. The token is never
  printed, and `--token` and `--config` are refused with `--host`. A refusal is exit `1`: an unknown
  or ambiguous name (the message lists the known hosts), no credential store (pair from the app),
  a plain `ws://` address outside a private network, or a token the host no longer accepts (pair
  the host again in the app). A host that does not answer is exit `2`. With `--json`, a refusal
  that comes from reaching the host is one JSON line on stderr, `{"error": "...", "reason": "..."}`,
  with a stable reason such as `unknown_host`, `no_store`, `token_refused` or `unreachable`; a refusal
  of the host's own daemon (a closed request, an unknown session) is a plain line. A write (`fd send`, `fd approve`,
  `fd deny`) that gets no answer says the change may have gone out: look before you repeat it.
- **The config:** `--config <file>`, else the default path (not with `--host`).

## fd host

```sh
fd host
fd host --json
```

Prints what the daemon says about its machine: the host name, the daemon version, the system, the
Claude version, how many sessions are active, the features it offers and whether bypass permissions
are allowed.

```text
host  orangepi
daemon  0.37.46
system  linux arm64
claude  2.1.0
sessions  2 active
features  central, workflows
bypass permissions  allowed
```

With `--json` the keys are `hostName`, `os`, `arch`, `daemonVersion`, `claudeVersion`,
`activeSessions`, `features` and `allowBypassPermissions`.

## fd sessions

```sh
fd sessions
fd sessions --json
```

Lists the sessions of the daemon, one line each: name, status and folder. With `--json` it prints an
array of objects with `id`, `name`, `cwd`, `status`, `permissionMode` and `updatedAt`. No sessions
gives an empty array.

## fd architect, fd reviewer, fd security, fd coordinator, fd new

```sh
fd architect
fd new qa
fd new qa --model opus
```

Opens `claude` with a persona, the same as `flightdeckd claude --persona <id>`. The four words are
shortcuts for the architect, the code reviewer, the security reviewer and the team coordinator;
`new <persona>` takes the id of any persona of the host, the project or the pack. Anything after
the persona goes to `claude` as it is. An id that does not exist is refused with exit code `1`, and
the message lists the ids that do.

The session is named `<repo>-<persona>` (for example `flightdeck-qa`), or just the repo name when
there is no persona. The repo is the top folder of the git repository you are in, else the
folder's own name. A name you pass (`--name` or `-n`) wins, and a launch that resumes a session
(`--resume`, `--continue`) or runs in print mode (`-p`) is not named.

## fd requests

```sh
fd requests
fd requests --session fd-qa
fd requests --json
```

Lists the permission requests that wait for an answer, oldest first. `--session` keeps one session
(its name or its id). Each line is the request id, the session, the risk, the tool and what it asks
for, cut at 120 characters. With `--json` it prints an array of objects with `id`, `sessionId`,
`session`, `tool`, `risk`, `riskReason`, `createdAt` and `input`. Nothing waiting gives an empty
array.

It lists the requests of the sessions Flightdeck manages. A request of a session you started by
hand is not listed, but `fd approve` and `fd deny` can still answer it if you know its id.

## fd approve and fd deny

```sh
fd approve <request>
fd approve <request> --message "once only"
fd deny <request> --message "too broad"
```

Answer one open request by its id, as the Approve button and the Deny button do. `--message` is what
Claude is told with the answer. Prints `allowed <id>` or `denied <id>`; with `--json`, an object
with `id`, `decision` and, when given, `message`.

A request the daemon rates **high risk**, or an allow that saves a rule, is not for the command line:
`fd approve` is refused with exit `1` and tells you to approve it in the app. The app signs the answer
with the key of your device (see `fd approvers`), and a script or an agent has no such key. A `deny`
never needs it. `--hold` is still accepted so that older scripts keep running, and it does nothing.

A request that is not open (answered already, or never there) is refused with exit `1` and
`no such request`. If the daemon is cut off before it answers, the exit is `2` and the answer may or
may not have been recorded: run `fd requests` to see if it is still open.

## fd send

```sh
fd send fd-qa "run the suite"
fd send 01J9… "stop and report" --json
```

Puts a text into a session, as the input box does. The session is its name or its id; a name that
two sessions share is refused, and the error lists their ids. Prints `sent to <id>`, or
`queued for <id>` when the session is busy and the text waits for its turn to end. With `--json` it
prints `session` and `queued`. If the daemon is cut off after the text left, the exit is `2` and the
text may or may not have gone in: look at the session before you send it again.

## fd approvers

```sh
fd approvers enroll
fd approvers enroll --json
fd approvers reset
```

A high-risk request, or an allow that saves a rule, is approved only with the signed proof of a device
you enrolled: the app signs the answer with a key that never leaves the device, and the daemon checks
the signature. These two commands are the only way to start or undo that, and they work from the
terminal of the host only: no message from the app, a session or a script can open the enrollment or
remove a key.

- **`enroll`:** prints a one-time code and opens a window of 10 minutes. Type the code into the app's
  device enrollment screen. The window closes when the first device enrolls, when the
  10 minutes pass, or after five wrong codes, and each run makes a new code. With `--json` it prints
  `code` and `expiresAt`. It is refused with exit `1` when a device is enrolled already: add another
  device from the app on the first one, or run `reset`.
- **`reset`:** removes every enrolled device and closes the window. The host goes back to how it was
  before the first device: a high-risk allow needs only the hold of the Approve button. Prints how many
  devices went; with `--json`, `removed`. The host keeps its identity.

Both read the data folder from the config file and work with the daemon running or stopped. Until a
device is enrolled, nothing changes for you.

## fd board

```sh
fd board settings
fd board settings --max-parallel-runs 4
fd board settings --json
fd board watch
fd board watch --json
```

`settings` shows the host-wide board settings, as the Projects screen does. `watch` follows the board.

- **`settings`:** prints `max parallel runs: <n>`, how many card runs the board starts at once on this
  host. With `--json` it prints the daemon's answer.
- **`settings --max-parallel-runs <n>`:** sets that limit (a whole number, 1 or more) and prints the new
  one. A value that is not a whole number of 1 or more exits `1` and sends nothing.

- **`watch`:** stays connected and prints a line each time a card changes, in the words of `card list`
  (`<id>  <column>  <title>`, with why it waits, if it does). It runs until you press Ctrl-C, which exits
  `0`. With `--json` it prints one card per line, as JSON, for a script. The 15 s limit covers only the
  connection; if the daemon goes away while you watch, it exits `2`.

A change that gets no answer exits `2` and says it may or may not have gone in: run `board settings`
before trying again. Exit codes are the same as the other commands: `0` done, `1` refused, `2` no daemon.

## fd history

```sh
fd history list [--cwd <folder>] [--project-key <key>] [--from <time>] [--to <time>] [--origin flightdeck|external] [--hide-automated] [--limit 20] [--cursor <c>] [--json]
fd history search "login bug" [--cwd <folder>] [--from <time>] [--to <time>] [--limit 10] [--json]
fd history get <session> [--tail] [--limit 50] [--cursor <c>] [--json]
fd history tool <session> <message> <index> [--json]
fd history resume <session> [--name <text>] [--permission-mode <mode>] [--force] [--json]
fd history watch [--json]
fd history reindex
```

`list`, `search`, `get` and `tool` read the conversations Claude Code already recorded, as the History
screen does. They change nothing, and the folders in `history.excludeCwds` stay out, as in the app.

- **`list`:** one line per session: id, time of the last message, folder, title and message count, with
  `[may be running]` when another process may still be writing it. A longer list ends with
  `more: history list --cursor <c>`; pass that cursor to read the next page.
- **`search <text>`:** one line per hit: session, message, time and role, then the excerpt with every match
  between `«` and `»`. Prints `no session matches` when there is none.
- **`get <session>`:** the transcript as text, one block per message (time, role, then the text). `--tail`
  opens on the last messages. A page ends with `more:` and, for a tail, `earlier:` lines that give the
  command that reads the next or the earlier page.
- **`tool <session> <message> <index>`:** the whole input and result of one tool call of a message (the
  `<message>` id is the second column of `search`, and `<index>` counts from 0). It says when the
  transcript held more than the 64 KiB shown. A call the transcript does not hold exits `1`.
- **`resume <session>`:** starts a new session that continues the transcript, in its folder, and prints
  `resumed as session <id>` (with `--json`, the daemon's answer). `--name` names it (the transcript's
  title by default) and `--permission-mode` picks its mode (the host's default otherwise). A transcript
  that may be running elsewhere is refused with `1` until you add `--force`. If the daemon does not
  answer, the message says the session may or may not have been started: check `sessions` before trying again.
- **`watch`:** keeps one connection open and prints a line for each transcript that grows: id, time of the
  last message, folder and `[may be running]` (with `--json`, one object per line:
  `claudeSessionId`, `cwd`, `lastTs`, `maybeActive`). It runs until Ctrl-C (exit `0`); if the daemon goes
  away it exits `2`.
- **`reindex`:** rebuilds the index; stop the daemon first (see [History](history.md)).

`--limit` takes 1 to 200 (to 500 for `get`). With `--json` all but `reindex` print the daemon's answer.
From a session's shell, a resume with `--force` or `--permission-mode` is rated high: the person confirms it.
Exit codes are the same as the other commands: `0` done, `1` refused, `2` no daemon.

## fd persona

```sh
fd persona list
fd persona list --scope project --project-path ~/work/api --language en
fd persona show architect
fd persona subagents --project-path ~/work/api --json
fd persona save architect --scope host --name Architect --description "Designs modules" --body-file architect.md
fd persona remove architect --scope host
fd persona reset reviewer
fd persona publish-agent architect --project-path ~/work/api --confirm
fd persona trust local --project-path ~/work/api --hash abcdef012345
```

`list`, `show` and `subagents` read the personas of this host, as the Personas screen does. `save`,
`remove`, `reset`, `publish-agent` and `trust` change them.

- **`list`:** one line per persona: its id, where it lives (`pack`, `host` or `project`), its name,
  `(edited)` for a pack persona this host changed, and, for a project persona, the start of its hash and
  `not trusted` until its hash is trusted. A last line names the project files that were left out and why.
  `--scope` keeps only `host`, `project` or `all` (the default) of them.
- **`show <id>`:** the persona with its description, the model, effort, tools and permission mode it
  sets, and its prompt. It says where the persona came from. An id the daemon does not know is refused
  with exit `1`.
- **`subagents`:** the agents a session in the project gets (`persona-<id>`), and the project personas
  left out because nobody trusted them yet.
- **`save <id>`:** creates or edits a persona. It needs `--scope host|project`, `--name`,
  `--description` and the prompt, from `--body <text>` or `--body-file <path>` (one of the two). It can
  also set `--model`, `--effort low|medium|high|xhigh|max`, `--tools Read,Grep` (only restricts),
  `--permission-mode` and `--icon`. A save replaces the whole persona: a field you leave out is cleared, so
  repeat the ones you want to keep. A project persona needs `--project-path`. The daemon refuses a prompt
  that holds a secret, with exit `1`.
- **`remove <id> --scope host|project`:** deletes the persona of that scope.
- **`reset <id>`:** puts a pack persona back as it came; the host's edit goes away.
- **`publish-agent <id> --project-path <folder>`:** writes the persona as the project agent
  `.claude/agents/persona-<id>.md`. It changes a file in the project, so it refuses with exit `1` and sends
  nothing until you pass `--confirm`.
- **`trust <id> --project-path <folder> --hash <hash>`:** trusts a versioned project persona, so its text
  reaches every session of the project. `--hash` is the start (12 or more hex characters) of the hash
  `persona list` showed: if the file was edited since, the command refuses with exit `1` and says the new
  hash, so you read it again. A persona that is already trusted is left as it is.

A change that gets no answer exits `2` and says it may or may not have gone in: run `persona list` before
trying again.

`--project-path` names the project folder (relative to where you run it); without it only the host's
personas count. `--language en` or `pt-BR` picks the language of the pack personas. With `--json` each
command prints the daemon's answer as one JSON object.

## fd rules and fd autoapprove

```sh
fd rules list --project api
fd rules list --json
fd autoapprove list
fd autoapprove list --project api --session <key> --limit 20 --json
```

These read what guards a project's sessions, as the Security screen does. Neither changes anything.

- **`rules list`:** the permission rules the project allows (`permissions.allow` of its
  `.claude/settings.local.json`), one per line, exactly as the file holds them (they are not redacted, so a rule that holds a secret shows it). `--project` is the name or the id
  of the project; a host with one project needs no `--project`. With `--json` it prints the list of rule
  strings. A project with no rules says so, and `--json` prints an empty list.
- **`autoapprove list`:** first the sessions whose automatic approval is suspended (they got
  third-party content), then the decisions of the automatic approver, newest first: the time, `allow` or
  `ask`, the risk, the tool, the session key, who decided (`rule` or `ai`) and why. `--project` keeps the
  decisions of one project and `--session` those and the suspension of one session key; `--limit` reads 1 to 1000 decisions. With `--json` it
  prints the daemon's answer, `decisions` and `suspended`. A secret that the approver quoted in a reason
  is cut out.
