# Harness D6: the reviewer agents and the protocol-surface ratchet (issue #169)

- **Protocol compatibility is a check, not an agent.** `scripts/lib/protocol-surface.ts` reads
  every exported schema of `packages/protocol` through its JSON Schema (`toJSONSchema`, input
  side) into one line per command, field (`?` when optional), constant and enum value;
  discriminated unions are named by their `type`, so reordering members changes nothing. A line of
  `packages/protocol/surface-baseline.txt` that the code lost fails `protocol-surface.test.ts`: a
  removed command or field, an optional field made required, a dropped enum value. Additions are
  free. Checked: making `HelloPayload.protocolVersion` required is reported.
- **The baseline moves at release only.** It holds main's surface (7,533 lines). The coordinator
  refreshes it with `bun run scripts/protocol-surface.ts --write` when cutting a release, so a
  branch that adds to the protocol never touches the file, and a removal between two releases is
  caught against what the last release shipped.
- **Two read-only agents, static.** `test-quality-reviewer` reads each `test(x)` and `feat(x)`
  pair, the red evidence in the message and the stub's tree through `git show`, and looks for tests
  that cannot fail (passing on the stub, red by error, weakened in the implementation commit,
  mock-only, hidden waits, vacuous loops); it runs only area tests and never checks out a commit
  (review S2-7: a fresh worktree has no dependencies). `security-reviewer` follows inputs from
  their protocol schema to spawns, paths, logs, refusals and the network, and complements the
  built-in `/security-review`. Both list `Read, Bash` (listing Bash drops Grep and Glob on Linux)
  and run on sonnet; `harness-config.test.ts` checks it.
- **No UX reviewer.** `demo:shots` already runs axe in both themes and languages, and the UX
  sessions read the prints.
