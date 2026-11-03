# Flightdeck — Phase 32 spec (modern UI, part 1: the quick wins)

## Goal

The user asked for a more modern UI with better ease of use and navigation. The research and the
audit are in `flightdeck-handoff/ui-modern-proposal.md` (top 10 changes, ranked by impact and
effort, each with its source pattern). This phase takes the quick wins: tokens and shared
primitives only, no screen is restructured. Part 2 (the rest of the top 10) waits for the weekly
budget reset.

Prerequisites: phase 10 (visual direction and tokens), phase 29 (states and layout primitives).

## Design

Part 1:

- **Calm chrome** (Linear's "calmer interface"). The sidebar and the page chrome step back so
  the task stays in focus:
  - sidebar items at the muted tone, the active item and the "Needs you" row at full contrast;
  - softer borders and separators in both themes;
  - the open screen is marked in the sidebar (`aria-current="page"`), so "full contrast for the
    active item" has something to hold on to;
  - the weight scale (bold only for titles and primary actions) waits for part 2: the buttons
    that carry `font-medium` are vendored in `components/ui`.
- **Motion tokens**: phase 10 already defined `--duration-fast`, `--duration-base` and
  `--ease-out-soft` in the theme, but nothing used them and the theme inlines them into
  utilities. `:root` gets `--motion-fast`, `--motion-base` and `--motion-ease` (same values, a test
  keeps them equal); controls, list
  rows and sidebar items ease their hover and selected colours with them. The existing
  reduced-motion block stays the off switch (it zeroes every duration).
- **Skeletons shaped like the content**: `LoadingState` takes a `shape` (`rows`, the default,
  `columns` for a board, `tiles` for a summary strip). The Board and Costs use their own shape.
- **Empty states with a next action**: an empty Board column offers "Add card"; the hub's
  "Choose a session" pane offers "New session". `EmptyState` loses its dashed border for a soft
  surface.
- **Board title bug**: the title read "Board of " (no name) until the project loaded. It reads the
  plain "Board" until the name is known.
- **Prints of loaded screens**: `demo:shots` waits until no skeleton or busy region is left
  before every print (`PENDING_SELECTOR`), so the Board and Costs prints show the real screen.

Part 2 (after the weekly reset, a separate hand-off), in the proposal's order:

2. slim session header (one line, one persona control, overflow menu);
3. palette v2 (commands, recents, shortcut hints, per-row actions);
4. shortcuts everywhere, a key registry, go-to chords and the `?` cheat sheet;
5. regrouped sidebar (pinned top, collapsible groups, live host dots);
6. one navigation level (breadcrumb and tab strip merged, fewer tab controls);
8. Costs summary strip and a single filter bar;
10. first-run checklist and a Settings rail with search.

(The session header was already slimmed in v0.31.1: item 2 shrinks to what is left.)

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `board-titulo` | the Board title is "Board" before the project loads, "Board of <name>" after, in both languages |
| `estados-forma` | `LoadingState` renders the `rows`, `columns` and `tiles` shapes, each `role="status"` and `aria-busy` with its label; the Board loads with columns, Costs with tiles |
| `estados-vazios` | an empty Board column has an "Add card" button that opens the new-card dialog; the hub pane has "New session"; `EmptyState` has no dashed border |
| `movimento-tokens` | `styles.css` defines the three motion tokens, controls and rows use them, and the reduced-motion block still zeroes durations |
| `cromo-calmo` | sidebar items use the muted tone, the active and "Needs you" items do not; borders are softer; filters and pills are not bold |
| `shots-carregados` | `PENDING_SELECTOR` matches every loading state the app renders; `demo:shots` waits for it before each print |

**Acceptance criteria:** the usual ones (the version stays as it is on `main`), the ratchets
(layout, wait, refusal, perf) green, axe clean in both themes and both languages, and the Board
and Costs prints showing loaded content.
