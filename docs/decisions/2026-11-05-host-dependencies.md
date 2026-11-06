# The host's dependencies (issue #121)

- **One command, the doctor's probes.** `deps.check` (feature `depsCheck`: `deps` already names the cards' dependencies) answers `{ items }`, each with its group, state (`ok`, `outdated`,
  `missing`, `na`), version, path, the least version, the features that break (ids the app translates) and a fix per OS. Programs are
  found with `whichOnPath` and asked `--version`; git needs 2.5 for worktrees. Fake CLIs and fakes of the machine drive the tests.
- **What the first draft left out, on purpose.** Claude Code is found and versioned, not asked whether it is signed in (that is the
  Claude account card's job and needs a model-free probe of its own); the MCP registration and the telemetry receiver are not rows yet
  (the MCP entry is now put in every managed session, so there is nothing to register by hand, and the telemetry has its own panel).
  The service row on Linux needs systemd, the unit and linger, so it says what #106 taught; on macOS it does not apply.
- **Icon and word, never color alone.** A required one missing is a red cross, an optional one missing or any outdated one an amber
  warning, OK a green check, not applicable a gray dash; each row and the headline also say it in words. The green is a new token
  (`--status-ok`) held to the AA contrast test of the other status colors in both themes.
- **The sidebar.** The host gets a red mark (with a label) when a required dependency is missing or outdated; the app asks each host
  that announces `depsCheck` once it is connected, and Check again updates the mark.
- **`flightdeckd doctor`** prints the same grouping after its own checks (`formatDeps`), in English like the rest of the terminal output.
- **Not in this change:** the link to the manual from each row.
