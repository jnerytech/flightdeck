# approval.watch announces enrolled and revoked devices, and `approvers watch --follow` prints them (issue #3476)

## Context

The app and a terminal learned that a device was enrolled or revoked only by reading `approval.list`
again. A key enrolled by someone else is the event a person most wants to hear about (#3423, #3477).

## Decision

- `approval.watch` (no payload) makes the daemon push `approval.enrolled` (key id, name, client,
  address, enrolled-at) and `approval.revoked` (key id) to that connection, as `history.watch` does. They
  are sent only after the store changed: a refused enroll, a revoke of an unknown key and a refused
  revoke of the last key send nothing. No event carries a public key, a nonce or a code.
- A new feature word `approval-watch` is announced with `approval-proof` (when the host runs approvers).
  A v0.38.0 host announces the proof but has no watch, so the app keys on the new word, not on the
  proof. A host without approvers refuses `approval.watch` with `feature_off`, like the other approval commands.
- A terminal `flightdeckd approvers reset` writes the store directly (no daemon in the path) and
  announces nothing. The next `approval.list` shows the empty list.
- `flightdeckd approvers watch` prints the current `approval.list` once and exits 0; `--follow` is the
  stream (NDJSON with `--json`), until Ctrl-C. This supersedes the line "There is no `--follow`" of
  `2026-11-20-cli-streams.md` for this verb: the coordinator answered #3454 "--follow NDJSON", and a
  verb that has a one-shot reading needs a flag to say it is a stream. `board watch` and `history
  watch` stay streams only. `streamFrames` takes a list of frame types, as this stream has two.
- Parity: `approval.watch` is a `cli` row (`approvers`). The four older `approval.*` rows stay `appOnly`:
  a signature needs a key a terminal has no part in.

## Not covered

A watch of challenges or approvals, and any change to who may enroll or revoke or to the proof.
