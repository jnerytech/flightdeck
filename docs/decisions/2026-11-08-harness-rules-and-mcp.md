# Rules close to the code go in `.claude/rules`, and there is no project MCP server (issue #169)

These are #169's scope items 4 and 6, the two that were never written down as decisions. Every
other item of #169 shipped (see the map on the issue).

## Item 4: rules close to the code

**Decision:** one mechanism, path-scoped `.claude/rules/*.md`. There are no per-package
`CLAUDE.md` files.

**Evidence:**
- **Proof of concept, 2026-11-04** (`claude -p` with an InstructionsLoaded hook, Claude Code
  2.1.318):
  - From the main checkout, a session that edits a sibling worktree
    (`../flightdeck-x/apps/daemon/...`) loads neither a `paths:` rule nor a nested `CLAUDE.md`, not
    even with `--add-dir` or `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.
  - With the session's folder set to the worktree, both load.
  - So the two mechanisms have the same precondition, and nested `CLAUDE.md` files buy nothing over
    rules.
- **Rules can cover more than one package.** `tests.md` covers `**/test/**` and `**/*.test.ts(x)`
  in every package. Per-package files would repeat it four times.
- **Shipped** in `feat(path-rules)` (d0f12fd95, 2026-11-05): `ui.md`, `protocol.md`, `daemon.md`,
  `tests.md` and `scripts.md`.
  - `claude -p` in a worktree showed that reading `scripts/test/slot.test.ts` loads `tests.md` and
    `scripts.md`, and a daemon file loads `daemon.md` (`path_glob_match`).
  - `harness-config.test.ts` fails a rule whose frontmatter does not parse, or whose `paths` match
    no tracked file. A frontmatter that does not parse loads the rule everywhere.
- **The precondition is met by convention and by a hook.** CLAUDE.md says to start each session in
  its own worktree. The SessionStart hook (`scripts/lib/session-context.ts`) tells a session in the
  main checkout that its rules and hooks load only in the worktree, and after a compact it reminds
  the session that a rule comes back only when a matching file is touched.

**Not done, on purpose:**
- Shrinking the root CLAUDE.md to about 60 lines. It is 258 lines, because the non-negotiables must
  hold when a session only `grep`s a file and no rule loads.
- Translating the older Portuguese parts of `docs/TDD.md`. Each translation would conflict with the
  open branches that edit it. New text there is in English.

## Item 6: a project MCP server

**Decision:** no project MCP server. Reopen this if a structured query appears that one command
cannot answer.

**Evidence:**
- **Everything it would serve is one command away:**
  - the slot: `bun run slot -- --status`;
  - the hooks' blocks and waivers: `bun run harness:stats`;
  - the ratchets: their JSON baselines;
  - the issue of a branch: `gh issue view`;
  - the terms: `docs/GLOSSARY.md`;
  - the protocol: `packages/protocol`, with `surface-baseline.txt` and the protocol-surface check.
- **The SessionStart hook and the skills already inject the context that matters:** the branch, the
  tested scopes and the slot, at no standing cost.
- **A server would cost more than it gives:**
  - a long-running process in every session on the Pi;
  - a project `.mcp.json` approval prompt;
  - its own tests at the coverage gate;
  - one more thing for the coordinator to restart after an out-of-memory kill.
- **No session has asked for one** since the proposal (2026-11-04). The repository has no
  `.mcp.json`.

The product's own MCP use (the `flightdeck` channel a session reaches through `--mcp-config`) is
a feature of the app, not of this harness, and this decision does not cover it.
