# Team sessions get the flightdeck MCP (v0.36.1, issue #95) (issue #1711, moved from DECISIONS.md)

- **Where it is injected.** `ClaudeSdkRuntime.start` is the single place every managed session passes through (coordinator,
  workers, board cards, plain sessions), so the `mcpServers.flightdeck` entry is added there, not in the team code. The command
  is the one the daemon runs itself (`daemonCommand`, so the compiled binary or `bun run <bin>`) plus `mcp --config <file>`.
  Its environment carries the session's own `FLIGHTDECK_SESSION`, which is how the tools know who is sending.
- **Merge, not replace.** The option adds to the servers of the user's and the project's settings (`settingSources` is
  unchanged and `strictMcpConfig` is not set). The key is `flightdeck`, the one `claude mcp add flightdeck` uses, so a person who
  registered it by hand ends with one entry; the daemon's entry wins for sessions it starts, because it is the one that knows
  the session id and the config file. The check for a hand-made entry is therefore by key, not by reading `~/.claude.json`.
- **Permission mode.** Nothing changes: a worker starts in the mode the team chose, and the injection never sets `plan`.
- **Doctor.** New `mcp` check ("Team tools"): a warning when the program the entry points to no longer exists, with the fix
  `run: flightdeckd setup`. It reads the file, it does not start the server.
- **Test.** `mcp-sessoes` takes the exact entry the runtime gives the SDK, starts it as a real child process against a daemon,
  and calls `send_to_session` through it.
