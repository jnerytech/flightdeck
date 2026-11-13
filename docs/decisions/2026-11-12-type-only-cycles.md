# The no-cycle rule keeps counting type-only imports (issue #1679)

## Context

The `no-cycle` rule in `.dependency-cruiser.cjs` covers the daemon and the protocol, and it counts
every import, `import type` included. Bun erases a type-only import, so a cycle made only of them
does not exist at runtime. The `server.ts` / `server/host-info.ts` cycle that opened #1679 was such a
cycle, and moves re-recorded entries like it in the baseline without changing runtime coupling.

Since then, #1611 broke the daemon's cycles one cluster per PR (58 when it opened). After #2426
one was left, `board/board.ts` to `issues/issues.ts`; #2416, the last slice, takes the `no-cycle`
baseline to 0. The `server.ts` / `host-info.ts` cycle went with the
`apps/daemon/src/server-options.ts` leaf and #2410.

## Decision

Keep counting type-only imports. The rule stays as it is: no `dependencyTypesNot: ["type-only"]`.

## Discarded alternative

Count runtime cycles only, and track type-only cycles in a separate figure. It would show the
runtime coupling alone, but:

- A type-only import still makes two modules change together: the rule's own reason (ADP). A
  cycle of types is the same design smell as a cycle of values.
- With the baseline at 0 after #2416, there is no backlog of type-only entries to separate. A second figure would
  add a rule and a column to `bun run arch` for nothing.

## Consequences

- Any new cycle fails `bun run arch`, type-only or not. The way out is the one #1611 used: move the
  shared type or constant to a leaf, or have the lower module declare the port it needs.
- No change to `.dependency-cruiser.cjs`.
