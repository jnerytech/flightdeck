# flightdeckd commands: host and sessions

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-commands.md)

Every `flightdeckd` command that asks the daemon of this machine works the same way. Below, `fd` is
the short name of `flightdeckd` (see #3433); until it ships, type `flightdeckd` in its place.

## What they all share

- **`--json`:** prints one JSON value and nothing else, for a script. A fact the daemon does not
  report is `null` (or an empty list), never missing.
- **Exit codes:** `0` done, `1` refused, `2` no daemon (not running, cut off, or too slow).
- **This machine only:** the command reads the token from the daemon config file and talks only to
  `127.0.0.1` or `::1`. `--token` is refused.
- **The config:** `--config <file>`, else the default path.

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
