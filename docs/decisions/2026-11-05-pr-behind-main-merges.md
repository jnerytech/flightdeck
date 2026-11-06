# A PR behind main merges; only a conflict waits (issue #305)

- **Why.** With the ruleset strict, every merge made each other PR behind, and each of them reran
  its whole CI before it could merge. The coordinator turned the up-to-date rule off: a green PR
  now auto-merges behind `main`, and `main`'s push CI (and `pr tag`, which needs a green full run
  on main) still catch a combined break.
- **`bun run pr` follows.** `pr next` lists a PR behind `main` as ready, and `pr merge` merges it,
  printing how far behind it is as a note for the coordinator's hand merges. What still blocks is a
  conflict, read from GitHub's `mergeable_state` (`dirty`): the message says to merge `main` into
  the branch and resolve it, since GitHub's update-branch cannot resolve a conflict.
- The #271 entry in `docs/DECISIONS.md` describes the strict ruleset; it is history.
