# An anti-corruption layer per external system (issue #1612)

Parent: #1589 (domain modules). Every program the daemon starts now starts from an `adapters/` folder
of the domain that owns the external system (git, gh, the claude CLI and its transcripts, WSL, ssh,
systemd and schtasks, the OS keychain, the terminal's pty, the actions' programs). Domain code sees
a port and plain data, never a command line or an output format.

## The two guards

- Dependency-cruiser rule `spawn-only-from-adapters`: a file under `apps/daemon/src` that is not in an
  `adapters/` folder, and is not `kernel/command.ts` or `kernel/exec.ts`, may not import `child_process`.
- `bun run arch` row "spawn-count launches outside adapters" (`scripts/lib/ratchets/spawn-count.ts`):
  `Bun` is a global, so the rule cannot see `Bun.spawn`; the text check reads the name under any
  spelling (a call, a default parameter, an alias, a `typeof`). The baseline is `{}` and stays empty: a
  launch outside an adapter fails at once instead of waiting for a lower number.

## The kernel exemption

`kernel/command.ts` (`runCommand`, `runLimited`) and `kernel/exec.ts` (`spawnExec`) are the shared
launchers: the adapters call them, and about twenty callers that run one plain command still do
(coordinator decision, 2026-11-13). They are exempt by path, not the whole `kernel/` folder: a new
kernel file that spawns must fail the check and move to an adapter.

## Not done here

Behavior is unchanged. A type that names `Bun.spawn` follows the same rule as a launch: the actions
domain's `SpawnProgram` type lives in its adapter and `run.ts` imports it.
