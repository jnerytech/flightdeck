# Reading the host's resources from a shell (issue #3699)

Slice 1 of the `resources` noun: bare `resources`, over `resources.get`. `resources pause-at` and `end-orphan`, and the
`host` switches (`sleep`, `keep-awake`, `pause`, `updates`, `bypass`), are the second slice.

- The verb reads and changes nothing, so it has no risk rating. It prints the executable names the daemon already
  limits to names (never a command line or an environment).
- The orphan line shows the pid and the start ticks, the two numbers `resources.endOrphan` takes, so the write slice
  needs no other source for them.
- `--host` works: `resources` is in `HOST_COMMANDS` and `JSON_COMMANDS`. A host that is not Linux has no process
  measure and says so in a line.
- The runner lives in `apps/daemon/src/resources/` behind its `index.ts`; the pure view is in `domain/`. The
  verb's run function is in `cli/resources-run.ts`, because `cli/commands.ts` is at the 800-line limit.
