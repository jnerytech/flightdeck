# main.ts as the composition root: commands in cli/, construction in each domain's wiring (issue #1593)

`apps/daemon/src/main.ts` held the command line, every subcommand and the daemon's whole
construction (2,865 lines on 2026-11-09). #1593 cuts it until it only starts the daemon and wires
domains together (under 400 lines). This file records the shape the cut follows, settled during
moves 1 to 8 (#1660 to #1668).

## Decision

1. **main.ts is the composition root.** It parses nothing, runs no command and builds no domain by
   hand: it calls each domain's constructor function in order, passes what one domain needs from
   another, and keeps `runCli` (which picks a command or starts the daemon) and the command table.
2. **The command line is a driving adapter, `cli/`.** `cli/args.ts` parses the words and flags;
   one file per domain the commands drive (`host.ts` service and update, `maintenance.ts`,
   `claude-settings.ts` hooks and telemetry, `setup.ts` setup, doctor and pair, `history.ts`)
   holds those commands. A command depends on its domains; no domain imports `cli/`.
3. **Each command group declares the deps it uses** (`HostCommandDeps`, `SetupCommandDeps`...).
   main.ts's `CliDeps` extends them (interface segregation): a command never sees the fields of
   another, and `cli/` never imports `main.ts`.
4. **A domain's construction lives in `<domain>/wiring.ts`** (`create<Domain>(deps)`, as
   `worktrees/wiring.ts`, `resources/wiring.ts`, `runtime/opencode-wiring.ts` and
   `updates/wiring.ts` already do). It takes its inputs explicitly and returns the objects the
   server and the other domains use. `startDaemon` shrinks one domain per PR.
5. **A domain gets its `index.ts` when another folder first needs it.** `bun run arch` counts a deep
   import across domain folders (a type-only import too) and its baseline only goes down, so a
   move into `cli/` or a `wiring.ts` reaches other domains through their public entry. The first
   entries came with the moves: `maintenance`, `store`, `central`, `telemetry`, `deps`,
   `templates`, `runtime`, `history`, `permissions`.

## Discarded alternatives

- **Each subcommand into the domain it drives** (the first plan on #1593). The commands take
  `CliArgs` and `CliDeps`, so every domain would import `cli/` and `cli/` would import the domains
  back: cycles at the folder level, and domain code that knows the command line.
- **A `register(ctx)` per domain that adds itself to a shared context.** It hides the order the
  daemon is built in (several domains need another one already built) behind mutation of a shared
  object, and each register would be a shallow function forwarding into the context.
- **A dependency-injection container.** A new dependency and runtime magic for wiring that fits in
  plain function calls; the type checker already proves the wiring.

## Consequences

- main.ts keeps the order of construction visible in one place; each `wiring.ts` is testable with
  fakes, like the domain itself.
- A new command goes to the `cli/` file of the domain it drives, with its fields in that group's
  deps type, not in `CliDeps`.
- `index.ts` files appear gradually: a domain without one is still reached by deep imports from
  main.ts (a root file, outside the arch rule) until a folder needs it.
- Each move is verbatim (structure only); doc comments that had been left away from their
  functions go back in their own `docs` commit.
