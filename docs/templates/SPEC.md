# Flightdeck — Phase N spec (theme in a few words)

<!-- Copy to docs/SPEC-fase-N.md, replace every placeholder, keep every `##` heading (write
"None." where a section does not apply), then run `bun run spec:lint docs/SPEC-fase-N.md`.
Extra headings are fine anywhere. -->

## Goal

The problem, for whom, and where it came from (an issue, research, a bug). The phases or issues
this one needs first.

## Non-goals

What this phase does not do, so nobody builds it by accident. None.

## Proof of concept first

Only when the phase depends on an external behavior nobody has confirmed (the Claude Code CLI, a
file format, a platform API). Numbered questions; each answer goes to DECISIONS before any area
starts. None.

## Design

The pieces, in short bullets: what the daemon keeps, what the app shows, what the protocol
carries. One idea per bullet.

## Protocol, migration and rollback

Commands or fields added to `packages/protocol` (additive only: a field is optional or new, a
refusal names its reason), store migrations and how a downgrade behaves. None.

## Acceptance scenarios

Only for journeys a person reads. Each `Feature:` names the file that runs it.

```gherkin
Feature: The example journey

  Scenario: What the person sees
    Given a starting state the scenario creates itself
    When the person does one thing
    Then they see one result
```

Runs as `scripts/e2e/bdd/features/example-journey.feature`.

## Tests and criteria

All tests use fakes: no network, no real `claude`, a temporary home.

| Area | Test file | What must pass |
| --- | --- | --- |
| `example-area` | `apps/daemon/test/example-area.test.ts` | the behavior, concrete enough that a weak assertion would not pass |
| `example-area-ui` | `apps/desktop/test/example-area-ui.test.tsx` | the screen, both languages, axe clean |

**TDD order:** `example-area`, then `example-area-ui`.

**Locks:** what must never happen (a token in a log, a call to the network, a sync call).

## Risks

What could go wrong for a user or another session, and what limits it. None.

## Acceptance criteria

The usual ones (TDD per area and the audit, 100% coverage, the smokes, both manuals, DECISIONS,
the spec-verifier's verdict is accept) and whatever is specific to this phase.

## Real checks

The checks that need the real Claude or a real machine, run at the end of all phases (Sonnet, a
short prompt). None.
