# Fix: `flightdeckd setup` in WSL (issue #1711, moved from DECISIONS.md)

- WSL is detected by `WSL_DISTRO_NAME`, else by "microsoft" in `/proc/version` (`wsl-host.ts`, an
  injected probe in tests). The host name default becomes "<hostname> (WSL <distro>)" (just
  "(WSL)" when the distro is unknown). It is a schema default, so it applies when a config is
  created; a config that already has `hostName` keeps it.
- Setup moves only the ports still at the Windows defaults (7420, 7421, 7422) up by 10, and writes
  them to `config.json`. A port the person chose stays, which also makes a second run a no-op.
  `telemetry.port` is written too (7432) although it would follow `hooks.port + 1`, so the file
  states every port.
