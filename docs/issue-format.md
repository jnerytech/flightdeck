# Issue format: the body is the spec (issue #1918)

An issue is the briefing a session starts from. Its body is a mini-spec in a fixed shape, so a
session starts from a stated goal, scope and proof instead of exploring first, and the coordinator
checks the work against a written criterion. `bun run issue` checks the shape; it cannot judge the
content.

```
bun run issue -- check --body-file body.md      # or: check <n> to read an issue from GitHub
bun run issue -- new --title "<title>" --body-file body.md
bun run issue -- edit <n> --body-file body.md
```

`new` and `edit` refuse a body that fails the check (exit 1, nothing is sent). `new` creates the
issue in this repository, assigned to the account that owns it, and prints its number. Board
placement and progress notes stay with `issue-note.sh`.

## The shape

The first line is the header: `Kind: feature|bug|refactor|task · Parent: #N|none · Budget: <N> min`.
Then one `## ` section per heading below. A heading inside a code fence is no section. A section
marked `-` is not checked for that kind.

| Section | feature | bug | refactor | task |
|---|---|---|---|---|
| `## Why` | required | required | required | required |
| `## Scope` | required | - | required (files or modules moved) | required |
| `## Out of scope` | required | optional | required | optional |
| `## What happens`, `## Expected`, `## Repro` | - | required | - | - |
| `## Scenarios` | required, at least one `GIVEN … WHEN … THEN …` item | required, at least one | - (behavior unchanged, proven by the suite) | optional |
| `## Tasks` | required, `- [ ]` items, one PR each | optional | required | optional |
| `## Done when` | required, at least one line with a backticked command | required | required | required |
| `## Context` | optional | optional | optional | optional |

A written `## Scenarios`, `## Tasks` or `## Done when` is checked even when optional. Every
scenario is one test: the tests of the issue are its scenarios.

## Examples

Each example below passes `bun run issue -- check`; a test reads them.

A feature:

```markdown
Kind: feature · Parent: none · Budget: 90 min

## Why
Sessions cannot tell which host a card runs on.

## Scope
- Show the host name on the card.

## Out of scope
- Moving a card to another host.

## Scenarios
- GIVEN a card on host pc WHEN the board renders THEN the card shows `pc`.

## Tasks
- [ ] One PR: the test first, then the label.

## Done when
- `bun run test:related -- --fast` green.
```

A bug:

```markdown
Kind: bug · Parent: none · Budget: 45 min

## Why
A paused team resumes by itself after a restart.

## What happens
The team is active again after the daemon restarts.

## Expected
The team stays paused until a person resumes it.

## Repro
1. Pause a team.
2. Restart the daemon.

## Scenarios
- GIVEN a paused team WHEN the daemon restarts THEN the team is still paused.

## Done when
- `bun --config=bunfig.area.toml test apps/daemon/test/teams/teams.test.ts` green.
```

A refactor:

```markdown
Kind: refactor · Parent: #1589 · Budget: 60 min

## Why
The module holds two reasons to change.

## Scope
- Move the formatter out of `apps/daemon/src/a.ts` into its own file.

## Out of scope
- Any change of behavior.

## Tasks
- [ ] One PR: structure only.

## Done when
- `bun run arch` shows no figure above its baseline.
```

A task:

```markdown
Kind: task · Parent: none · Budget: 20 min

## Why
The setting is read in three places and written in none.

## Scope
- Add the setting to the shared file.

## Done when
- `bun run typecheck` green.
```
