# Harness D4: the hand-off stamp, checked by the receiver (issue #169)

- **Receiver-side, no hook** (review S2-5, S1-1). The proposal's sender-side gate (a `PreToolUse`
  hook on `SendMessage` matching "hand-off") depended on an undocumented tool input, matched the
  repo's own names (`flightdeck-handoff/`) and could be skipped by resending. Instead
  `bun run handoff:check` runs `typecheck`, `lint`, `tdd:audit` and `test:related` in order (all
  of them, so one run shows every failure), prints one stamp line
  (`HANDOFF <branch> <head> typecheck=0 lint=0 audit=0 related=0 <time>`) and keeps it in the
  worktree's git folder. The session pastes the line in its hand-off; the receiver (the
  coordinator, or `spec-verifier`) runs `bun run handoff:check -- --verify` in the worktree, which
  refuses a missing stamp, one for another HEAD, or any check that was not 0.
- **Never under the slot** (review S2-2): `test:related` takes the slot by itself above 60 files.
