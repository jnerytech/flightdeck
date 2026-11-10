# The rc/0361 gate: three leaks of the machine into the tests (issue #1711, moved from DECISIONS.md)

- **The focus ring** (`abas-foco`): the crumb fix moved the tab's ring to the strip with `has-[[role=tab]:focus-visible]` so the outline
  holds the close button, and left the focused element with none. Both stay: the tab has its own ring (it works where `:has` is
  missing) and the strip draws the outline around the tab and its ×.
- **Telemetry variables** (`isolamento-telemetria`): a session that has Claude Code's telemetry on sets `CLAUDE_CODE_ENABLE_TELEMETRY`
  and `OTEL_*`; `launch()` passes the environment on, so `otlp-ligar` compared what the test expected with what the session had.
  The test preload now strips them next to the `GIT_*` variables, from `process.env` and from the default environment of a spawned child.
- **Fixed ports** (`portas-fixas`): `raizes-persistencia` started a daemon on 7421, which the real daemon of the machine holds
  (7420 to 7422). It asks for port 0, and a ratchet test now refuses a fixed 742x in a server started by a test (`startServer`,
  `Bun.serve`, `.listen(`, or a config written for a `startDaemon` without a spread that lets the caller override it). Pure
  functions and pairing links that only mention 742x are data, not servers.
