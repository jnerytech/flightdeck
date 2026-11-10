# Session timing (telemetry)

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/session-timing-telemetry.md)

Claude Code can export OpenTelemetry (OTLP). The daemon receives it on this machine and uses it to
show the **time**, the **cost** and the **bottlenecks** of sessions opened in a terminal: a slow
tool, the time Claude waited for you to answer a permission, an API error.

- **Where it listens:** `127.0.0.1` only, on `telemetry.port` (`hooks.port + 1` when absent), with
  a token of its own that is not the hooks token or the app's. A request without the token is
  refused, and so is a body over 1 MiB. It listens only while telemetry is on (`telemetry.enabled`,
  on by default) **and** the hooks are installed, so a daemon without them opens no extra port. If
  the port is taken the daemon logs it and carries on without the receiver.
- **Turning it on for a session:**
  - `flightdeckd claude` gives the claude it opens the exporter variables
    (`CLAUDE_CODE_ENABLE_TELEMETRY`, the OTLP exporters for metrics and logs, the endpoint, the
    header with the token and short intervals). It adds nothing over an exporter you already set
    yourself, and nothing in print mode (`-p`).
  - For a plain `claude`, use **Install telemetry** in the **Telemetry** panel of the host page (it asks first, naming the file and the backup), or run `flightdeckd telemetry install`: it writes the same eight keys into
    `env` of `~/.claude/settings.json`, after a copy in
    `settings.json.flightdeck-telemetry-backup`. If any of those keys already holds a value of
    yours it stops, names the keys and changes nothing. `flightdeckd telemetry status` says
    `installed`, `absent`, `outdated` or that an exporter of yours is there;
    `flightdeckd telemetry uninstall` (or **Remove telemetry**) takes out only Flightdeck's keys and **changes the token**,
    so a copy of the old one stops working.
- **What is kept:** for each event the session, the prompt, the time, how long it took, the cost,
  the tokens, whether a tool worked, the error type or HTTP status, and who answered a permission.
  **Prompts, answers, tool parameters and API bodies are never collected.** Flightdeck never sets
  an `OTEL_LOG_*` variable, and if an exporter sends such text anyway it is dropped on arrival.
  Events are kept for 30 days (`telemetry.retentionDays`).
- **The Time tab:** in a session with data, **Time** (**Tempo** in Portuguese) lists each prompt
  with its steps in order: the API requests, the tools with their time (a bar shows each against
  the longest step of the prompt), the permissions and how long you kept Claude waiting, and the
  API errors. The wait is an estimate: the gap between the step before and your answer.
- **In Costs:** **Time per project** shows, per project, the time spent waiting for permissions
  and the slowest tools (average, maximum, calls). A notice appears when a session's cost in the
  telemetry is far (over 10% and US$ 0.05) from the one computed from the transcripts, for the
  stretch of the session the exporter was on.
- **Limits:** only sessions that sent telemetry have data; the metrics the exporter sends are
  accepted and not kept. For developers, `bun run smoke:otel` runs the whole path with a fake
  claude.
