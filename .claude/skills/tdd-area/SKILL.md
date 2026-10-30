---
name: tdd-area
description: Drives one Flightdeck TDD area (stub → red by assertion → commit the test alone → green → full suite → feat commit). Use when implementing any area in the table of a docs/SPEC-fase-N.md, or when fixing a bug with fix(<area>).
---

# One TDD area

The source of truth is `docs/TDD.md`. Read the whole file at the start of the phase, and again
when in doubt. The steps below are the route; they do not replace the file.

## Route

1. **Area and file.** The area comes from the phase spec's table. The area's test is a single
   file: `apps/<app>/test/<area>.test.ts(x)`, `packages/protocol/test/<area>.test.ts` or
   `scripts/test/<area>.test.ts`.
2. **Stub.** Create the module with the real signatures returning wrong values (`""`, `[]`,
   `false`, `null`), never `throw`. The stub does not go into the test commit.
3. **Red by assertion.** Run `bun --config=bunfig.area.toml test <file>`. The failure must come
   from an `expect(...)`, not from an import, syntax, type or timeout. If it comes from an error,
   adjust and run again. Show every run.
   - UI: `queryBy*` + `expect(...).not.toBeNull()`, never `getBy*`.
   - No `toMatchSnapshot`. Use hand-written literals.
4. **Commit the test alone:**
   ```bash
   git status --short
   git add <test file>
   git commit -m "test(<area>): <behavior>"
   ```
5. **Green.** Minimal implementation, the same command green, then:
   ```bash
   bun run test && bun run typecheck && bun run lint && git add <paths> && git commit -m "feat(<area>): ..."
   ```
6. **Coverage points at an untested branch?** Remove the branch, write the test, show the red and
   only then restore it.
7. **Wrong test?** Fix it in a `test(<area>)` before the `feat`, without weakening the assertion.
   Lint and formatting are `refactor(<area>)` or `chore`, never `fix`.

## Reminders

- One scope per commit. New behavior outside the phase's table gets its own scope and cycle.
- Smokes also start red: a controlled exit with code 1 at the right step, in a
  `test(<area>)`.
- Nothing touches the real Claude: a fake executable on the PATH through `whichOnPath`, and a
  nonexistent `claude.executablePath` in the daemon tests with the `claude` runtime.
- At the end of the phase: `bun run tdd:audit -- --since $(git merge-base HEAD main)` (or the tag
  the spec sets) must print `TDD AUDIT OK`.
