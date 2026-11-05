---
paths:
  - "scripts/**"
---

# Scripts, checks and hooks (scripts)

- Functional core, imperative shell: the logic is a function in `scripts/lib/` that takes its
  effects (git, fs, clock, spawn) as a deps object, such as `runAudit({ since, git, readFile })`;
  the entry file in `scripts/` only wires the real ones. `scripts/test/` calls the function with
  fakes, at 100% lines and functions.
- The rules of the Claude Code hooks live in `scripts/lib/claude-hooks.ts`; the files in
  `.claude/hooks/` only read stdin, call it and exit. A hook fails open on its own errors.
- A ratchet is a bun test with a baseline that only goes down (`overBaseline` in
  `layout-ratchet.ts`). Reuse that shape for a new one.
- The heavy runs (the full suite, e2e, `demo:shots`, the smokes, the builds) go through
  `bun run slot --`; `typecheck` and `lint` take a place in the light lane by themselves.
- A data file a test reads (a baseline, a config) is named in the test as a path string, so
  `test:related` finds the test when the file changes.
