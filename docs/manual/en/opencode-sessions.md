# OpenCode sessions

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/opencode-sessions.md)

A host can also run [OpenCode](https://opencode.ai/v2/docs/) sessions, started from the app, next to
Claude Code's. Flightdeck talks to OpenCode over the Agent Client Protocol (`opencode acp`), one
process per live session. It needs OpenCode 2 and was verified with 2.2.5; a newer version runs but
is shown as not verified. OpenCode is off on every host until you turn it on.

## Turning it on

1. Install OpenCode on the host (its install script puts it in `~/.opencode/bin`) and sign in to a
   provider with OpenCode's own `opencode auth login`. Flightdeck never reads OpenCode's credentials.
2. In the host's config, add `"opencode": { "enabled": true }`. If `opencode` is not on the daemon's
   PATH or in `~/.opencode/bin`, add its path: `"opencode": { "enabled": true, "executablePath": "/path/to/opencode" }`.
3. Restart the daemon.

At start the daemon runs `opencode --version` and a canary: a harmless `opencode.json` in a folder of
Flightdeck's own must not be read, which proves the project config is off on that version. If
something fails, the host lists OpenCode as unavailable with the reason, and `flightdeckd doctor`
shows it on its OpenCode row. That row never fails the doctor. On Windows and macOS it adds
"unverified on this OS": the global config paths there were not checked on a real machine yet.

## Starting one

**New session** shows **Agent** only on a host that has OpenCode on. Choose **OpenCode**: the model
list comes from the host (`opencode models`), **Effort** picks how hard the model works, and the
permission modes are **Default** and **Plan** (and **Bypass permissions** when the host allows it).
There is no persona. The models are grouped by provider. The session's page and its row in the
session list show an **OpenCode** badge. The timeline says when the project's `AGENTS.md` went with
the first message, or why it did not.

## What an OpenCode session asks

- Every tool call asks you first, as a Claude Code session in Default mode does. Reading, listing
  and searching files inside the session's folder is allowed without asking, except credential
  files; a path that leads out of the folder (a link included) asks.
- Nothing is approved automatically, and the app never answers OpenCode with "always": each answer
  covers one request.
- OpenCode's question tool and its subagents are off.
- A message that starts with `/` is sent as plain text, so OpenCode's commands (its own and a
  project's) do not run.
- If something outside Flightdeck changes OpenCode's rules or mode while a session runs (OpenCode's
  own TUI, a config file edited meanwhile), the session stops with a message saying what changed.

## What an OpenCode session does not have yet

These stay with Claude Code sessions for now: personas, teams and messages between sessions,
board cards and arena variants, starting in the background, fork, "Open in terminal", the session
summary, the Changes, Time and Trace tabs (they read Claude Code's transcript), the Accept edits and
Automatic modes, automatic approval, the Costs page with its budgets and quota, importing
OpenCode's past sessions into History, and the MCP screen. The timeline stays: its git snapshots
are taken on every turn, so rewinding files works, and the model can be switched while the session
runs, from OpenCode's list. Each turn's result line still
shows the session's cost so far, as OpenCode reports it.

## Why the project's own opencode.json is ignored

A project's `opencode.json` and `.opencode/` folder can allow every tool, load plugins (code that
runs when OpenCode starts), start MCP servers and define commands, so Flightdeck starts OpenCode with
the project config off and its own two agents (`flightdeck` and `flightdeck-plan`), with OpenCode's
built-in agents disabled. The project's `AGENTS.md` is still used: Flightdeck reads it and sends it at
the start of a new session, labeled "project instructions (AGENTS.md)", up to 64 KB, without following
its `@` imports.

Your global OpenCode config (`~/.config/opencode`, or `$XDG_CONFIG_HOME/opencode`) is kept, so your
providers and default model still apply, but the daemon scans it before running OpenCode: a plugin
(in `plugins` or in the `plugins/`, `plugin/`, `tool/` or `tools/` folders), an enabled MCP server,
or any system or managed config makes OpenCode unavailable on that host, with the finding named.
Before each start and resume, a preflight asks OpenCode how it resolved the config for that folder,
and refuses the session if anything would outrank Flightdeck's questions.

## Removing saved rules

Answering "Always allow" in OpenCode's own TUI saves a rule for that folder's project, and a saved
rule skips the question. Flightdeck then refuses to start an OpenCode session there, and the
message lists the rules and the commands that remove them. Flightdeck never removes them itself. In
that folder, on the host:

```sh
opencode api GET /api/permission/saved --standalone              # lists the saved rules
opencode api DELETE /api/permission/saved/<id> --standalone      # removes one by its id
```

## Checking a new OpenCode version

`bun run smoke:opencode-real [--model <id>]` (from a source checkout on a host with OpenCode signed
in) runs the real OpenCode against a hostile scratch project: no plugin, MCP server or `/` command
of the project runs, the first shell command asks, and a saved rule makes the preflight refuse until
it is removed. It deletes the OpenCode sessions and saved rules it made. Run it after each OpenCode
upgrade; it is never part of the tests or CI. `bun run smoke:opencode` checks the same path with a
fake OpenCode.
