# flightdeckd statusline and hook session-start start-up time (issue #1692)

`flightdeckd statusline` runs on every redraw of Claude Code's status line, and `flightdeckd hook
session-start` runs when a session starts. Both are short commands, yet `bin.ts` imports `main.ts`,
and `cli/commands.ts` imports the module of every command, so each of them loads the whole daemon
before it parses its arguments.

## Before (measured 2026-11-13, commit 1f052001e)

Orange Pi (8 cores, load average about 12 from the other sessions), Bun 1.4.4, ten runs of
`bun src/bin.ts statusline --config /tmp/nonexistent-fd.json </dev/null`, wall time in ms, sorted:

    685 692 719 766 786 794 816 836 925 1178

Median about 790 ms, fastest 685 ms. An empty `bun -e ""` takes 5 to 10 ms on the same machine. The
command exits 0 and prints an empty line.

Windows is not measured: Windows is not in CI (#534), so a figure needs a run on a Windows host.

## After (measured 2026-11-13, same command, same machine, same load)

Ten runs, wall time in ms, sorted:

    216 233 258 264 295 317 325 361 383 475

Median about 310 ms, fastest 216 ms: about 2.5 times faster. What is left is the cost of loading the
config schema and the costs domain, which `statusline` needs; the daemon's own start-up is not in it.
`flightdeckd hook session-start` loads 48 source files and none of `main.ts`, `server/` or
`messaging/` (the new test `cli-startup` checks both commands).

## Decision

- `bin.ts` parses the arguments and runs a command from the `COMMANDS` table before it imports
  `main.ts`; only the daemon (`start`) imports `main.ts`.
- Each command loads its own module with `await import()`, so `statusline` loads the config and the
  costs domain and nothing else.
- What a command prints and returns does not change, and neither does the daemon's own start-up.
- The command modules are loaded on demand, so a command that does not need `messaging/` never
  evaluates it. A separate narrow entry for `messaging/cli.ts` would save about 10 ms for the
  `message` command only (226 ms against 215 ms to import), so it is not added.
