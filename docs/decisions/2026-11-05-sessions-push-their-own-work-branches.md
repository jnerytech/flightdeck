# Sessions push their own work branches (issue #218, part of #216)

- **The rule moves from "sessions never push" to "sessions push only their own work branches".**
  The guard (`pushViolation` in `scripts/lib/claude-hooks.ts`) blocks a push to `main` or
  `rc/*`, a tag (a `refs/tags/` refspec or the name of a local tag), `--tags`, `--all`,
  `--mirror` and `--follow-tags`. A push with no refspec, or of `HEAD`, means the current branch.
- **"Own branch" is the branch checked out in that checkout.** Who created a branch is not
  recorded anywhere; the branch a session works on is. A `--force-with-lease` passes only to it.
  A bare `--force` (or a `+` refspec) is blocked even there, which is stricter than #218's text:
  `--force-with-lease` does the same job without overwriting a push someone else made.
- **The coordinator is exempt through its environment.** `FLIGHTDECK_COORDINATOR=1` in the hook's
  own environment lets every push through. The coordinator's launch must set it
  (`start-flightdeck.sh`). A session cannot fake it: a `FLIGHTDECK_COORDINATOR=1 git push`
  prefix changes the command's environment, not the hook's.
- **Other repositories are not checked**, the same as the commit gate (`checkoutRoot`).
- **Limits.** Like the other guard rules, it reads the command's words: `sh -c "git push ..."`, a
  subshell or `gh` calls that push are not seen. It is a guardrail; branch protection on `main`
  is the wall.
- **`findCommit` and `pushViolation` share one parse** (`gitCalls`): the masked segments, each
  `cd`, `git -C`, and the subcommand's words with their offsets.
