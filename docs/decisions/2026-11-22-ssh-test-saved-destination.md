# SSH Test connection tests the saved destination only (issue #4330)

## Context

On the SSH screen's destination form, Test connection sends `ssh.test { targetId }`: the daemon
tests the destination as it is saved. After a person edited the host or the port, the line
"Connection ok." described the old values, and a new destination had a grey Test button with no
reason.

## Decision

- `ssh.test` stays `targetId` only. The daemon never runs ssh on text typed in the screen, so there
  is no protocol or security change.
- While the form differs from the saved destination, Test is disabled and says why ("Save to test
  these values"). The result line is shown only while the form matches the saved values, so it can
  never describe values that are not on screen.
- A new destination has no Test button; it shows after the destination is saved.

## Discarded

- Testing the typed values: a new payload that makes the daemon run ssh on text from the screen,
  a protocol and security change (decided by fd-coordinator, 2026-11-22).

## Consequences

- A person who wants to test a change saves it first; a bad save is one edit away from fixed.
- The dirty check lives in `features/ssh/domain/target-form.ts` (`unsaved`) and compares the form
  with the saved destination the way a save would write it.
