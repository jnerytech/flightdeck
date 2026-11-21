# flightdeckd commands: the log, the releases, the alerts and the activity of a host

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-feed-commands.md)

The verbs that read four feeds of a host: the daemon's own log, the releases of the app, the open alerts of a project's
repository and what happened on the host since a time. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). None of them changes anything. `--host <name>` reads
a paired host, and the exit code is `0` for done, `1` for refused and `2` when no daemon answers. With `--json` each
verb prints one JSON value with every key, and `null` for what a host leaves out. Text a person, a scanner or a session
wrote is printed with its control characters replaced, so it cannot drive the terminal.

## fd logs

```sh
fd logs tail
fd logs tail --lines 200 --json
```

`tail` prints the last lines of the daemon's own log, one per line, newest last. `--lines <n>` takes a whole number from
1 to 500; the host decides the default. An empty log prints `no log lines`. `--json` prints `{ "lines", "path" }`.
The log is redacted by the daemon, but it holds paths and hosts, so in the shell of a session `logs tail` is a
high-risk command: the app asks the person first.

## fd releases

```sh
fd releases list
fd releases list --limit 5 --json
```

`list` prints the number of releases, then one line each (the tag, when it was published and its title) followed by the
highlights of its notes, one `-` line each. `--limit <n>` takes a whole number from 1 to 20. No release prints
`no releases`. `--json` prints a list of `{ tag, title, publishedAt, url, highlights }`.

## fd alert

```sh
fd alert list api
fd alert list api --json
```

`list <project>` prints the open code-scanning and Dependabot alerts of the project's repository, which the host reads
with `gh`: one line each with the severity, the kind and number, the title and where it is. A project is named by its id
or its name; a name that is unknown exits `1` and lists the projects there are. A source the host could not read adds a
line such as `dependabot alerts could not be read: gh is not signed in`. No alert prints `no open alerts in <project>`.
`--json` prints `{ "alerts", "unavailable" }`.

## fd activity

```sh
fd activity since 2026-11-20T09:00:00Z
fd activity since 2026-11-20T09:00:00+02:00 --limit 10 --json
```

`since <time>` prints what finished, reached review, merged or failed on the host since the time, as the app's "While
you were away" does: the sessions that ended, the cards in review, the pull requests (merged, or open with failed
checks) and the failed runs, each list with its count (`3 of 12` when the host cut it to the newest), then the quota
windows now. The time is an ISO date and time with its zone; another spelling, such as `yesterday` or a bare date, exits
`1`. `--limit <n>` takes a whole number from 1 to 50. When nothing happened it prints `nothing happened since then`.
`--json` prints `{ since, sessions, reviewCards, prs, failedRuns, quota }`, each list as `{ total, items }`.
