# Harness: decisions on the independent review of the #169 proposal (issue #169)

The review (OpenCode, 2026-11-04) ranked 20 findings. Each one is accepted, deferred to its
delivery, or rejected:

| Finding | Decision |
| --- | --- |
| S2-1 "a test commit holds only tests" | Accepted: never enforced (see D1 above). TDD.md's text against the practice is for the maintainer. |
| S2-2 D7 under the slot deadlocks | Accepted: D4 and D7 come after #141 (`slot-reentrant`, v0.36.3); the eval's model phase runs outside the slot, `handoff:check` never under it. |
| S2-3 no waiver path, missing types | Accepted: the `TDD-Waiver:` trailer; `style`, `revert`, `Merge`, `Revert`, `fixup!` and `squash!` pass; a commit with no readable message passes. |
| S2-4 hook timeouts, onFailure | Accepted: see D1 above. |
| S2-5 D4 sender-side keyword gate | Accepted: D4 becomes receiver-side. `handoff:check` prints one stamp line (HEAD, four exit codes, time) that the session pastes; the orchestrator or `spec-verifier` checks it for HEAD. A sender hook, if any, comes after S1-1 and only advises. |
| S2-6 `test:related` misses non-TS changes | Accepted: see D1 above. |
| S2-9 log volume and rotation | Rejected in part: the log already rotates by `rename`, never truncates, and a lost line is acceptable. Every call is kept: `biome-on-edit`'s latency is what decides S3-6. |
| S2-10 the gate is a guardrail | Accepted: TDD.md says so; the audit in CI is the wall. |
| S2-11 `fase-N` tags | Accepted: `--match 'v[0-9]*'`. |
| S3-1 heavy runs outside the slot | Accepted: see D1 above, with the slot-holder exception. |
| S3-2 `merge=union` on DECISIONS.md | Rejected: union keeps both sides of a conflict without order, so two branches appending near the same heading can interleave silently. D2b's one file per unit of work removes the conflicts at the root. |
| S3-3 the setup itself is untested | Accepted: `harness-config.test.ts`. |
| S3-4 branch-aware push guard | Rejected for now: the orchestrator pushes feature branches from the same checkout, so a rule by branch would block it. It needs a session identity, not a branch. |
| S1-2 rules lost after `/compact` | Accepted for D5: every rule that guards a non-negotiable stays in the root CLAUDE.md, path-scoped rules are a bonus, and a `SessionStart` hook with `matcher: "compact"` restates the essentials (S3-5). |
| S1-3 unquoted `paths:` globs | Accepted for D5: list form with quoted patterns; `harness-config` parses every frontmatter. |
| S1-4 `claude -w` | Accepted: dropped. A dev session starts with `cd ../flightdeck-x && claude`, or moves with `/cd`. |
| S1-1, S2-7, S2-8, S3-5..S3-9, S4-1..S4-7 | Deferred to their deliveries (D2, D4, D5, D6, D7), where each is decided before the code. |
