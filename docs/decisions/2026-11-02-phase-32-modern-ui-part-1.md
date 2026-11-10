# Phase 32 — modern UI, part 1 (phase 32)

- The proposal's "motion tokens" already existed (phase 10) but were unused and not emitted by
  `@theme inline`; `:root` now carries plain `--motion-*` copies, kept equal to the theme's by a
  test, and a base rule eases colour changes on buttons, tabs, menu items and options.
- The sidebar had no notion of the open screen. `activeNav(route)` (from `tabKind`) marks it with
  `aria-current="page"`; other items sit at 70% and "Needs you" is full contrast while anything waits.
- `--border` and `--sidebar-border` went from 8% to 6% alpha. `--input` is untouched, so fields
  keep their edge.
- The Board keeps its real columns while loading (tests drive the board during the loading
  window); the `columns` skeleton sits above them, and the prints now wait for it to go.
- `demo:shots` waits for `PENDING_SELECTOR` (`[aria-busy="true"], [data-slot="skeleton"]`) before
  every print, up to 15 s.
- Not done in part 1: the weight scale (vendored buttons), splitting hover motion into per-component
  enter animations. Both go to part 2.
