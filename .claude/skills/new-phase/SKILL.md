---
name: new-phase
description: Opens a new Flightdeck phase (writes docs/SPEC-fase-N.md in the format of the earlier ones, prepares the worktree and the branch) or closes a phase (the "usual" checklist). Use when planning, starting or wrapping up a phase. Argument: the phase number.
---

# Open or close a phase

The argument is the phase number (`N`). Phase sessions never push, tag or release: they hand
the green HEAD to the maintainer, who integrates it into `main`. The audit uses the branch's
base commit, so no tag is needed while the phase runs.

## Open

1. **Context.** Read the previous phase's spec and the end of `docs/DECISIONS.md`, so as not to
   repeat what was already done and to respect the decisions.
2. **Spec.** Write `docs/SPEC-fase-N.md` in English (see CLAUDE.md), in the format of phases 22
   to 27:
   - `# Flightdeck — Phase N spec (<theme>)`
   - `## Goal`: the problem, where it came from (research, request, bug) and the prerequisites
     (phases).
   - `## Proof of concept first`: only when the phase depends on an unconfirmed external
     behavior (the Claude Code CLI, a file format). Numbered questions, with the result going to
     DECISIONS.
   - `## Design`: the pieces, in short bullets.
   - `## Tests and criteria`: the table `| Area | What must pass |`, with areas in kebab-case
     and the `-ui` suffix for screens, plus a new smoke if the phase needs one (`smoke:<name>`,
     printing `SMOKE <NAME> OK`).
   - `**Acceptance criteria:** the usual ones and <whatever is specific>.` The version is not part
     of them: a phase branch does not bump it, because phases land out of order; the maintainer
     sets it at release with the `test(versao)` cycle.
3. **Worktree and branch**, from an up-to-date `main`, beside the main checkout. Run from the
   main checkout:
   ```bash
   git worktree add ../flightdeck-faseN -b fase-N main
   cd ../flightdeck-faseN && bun install --frozen-lockfile
   ```
   `.claude/` is versioned, so the worktree already has the skills, the agents and the hooks.
   The hooks also cover files in the worktrees when the session runs from the main checkout.
4. **Areas.** Each area in the table follows the `tdd-area` skill. The proof of concept, when
   there is one, comes before any area.

## Close: "the usual"

Each item with its command and exit code visible:

- [ ] TDD per area and the audit: `bun run tdd:audit -- --since $(git merge-base HEAD main)` →
      `TDD AUDIT OK`.
- [ ] 100% coverage: `bun run test`. Then `bun run typecheck` and `bun run lint`.
- [ ] Every smoke in `package.json` except `smoke:real`, each with its `... OK`.
- [ ] Builds: `bun run build:daemon` and `bun run build:desktop`.
- [ ] The version is left as it is on `main`: phase branches do not bump it, the maintainer sets it
      at release with the `test(versao)` cycle.
- [ ] When the phase changes the screens: the prints and the axe check (`bun run demo:shots`)
      and the end-to-end journeys (`bun run e2e`), in both languages.
- [ ] README (pt-BR and en), manual (`docs/manual/`) and `docs/DECISIONS.md` with the phase's
      section.
- [ ] The `spec-verifier` agent's verdict is **accept**.
- [ ] Hand over: the HEAD, the commands above with their exit codes and the verifier's table. The
      maintainer pushes, waits for CI, tags and releases.
- [ ] The spec's specific items, such as a check with the real claude. Use Sonnet and a short
      prompt, to save quota.
