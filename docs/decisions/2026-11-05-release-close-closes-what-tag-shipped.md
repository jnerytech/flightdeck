# `release:close` closes what a tag shipped (issue #252)

- **What it reads.** The commits of `<previous v* tag>..<tag>` (`--since` names another start). An
  issue counts when a subject names it (`(#170)`, the repository's habit) or a body line starts with
  `Closes`, `Fixes` or `Resolves #N`. A number mentioned anywhere else in a body ("the overlay of
  #233 is deferred") is listed and never touched, and a pull request's number is skipped.
- **Dry run first.** Without `--apply` it only reads (the issue, its comments, the milestones) and
  prints what it would do. With `--apply`, each open issue gets "Shipped in <tag>." (once: an
  existing comment with that text is not repeated), is closed as completed, and goes to Done on the
  board; an issue already closed only goes to Done. A second run changes nothing.
- **The milestone** named after the tag is closed when it has no open issue left and no step of the
  run failed, so a run that failed halfway leaves it open for the retry. One with issues the tag
  did not ship stays open and says how many.
- **REST only.** Every call is `gh api` with `-f` fields (no GraphQL), and the board goes through
  `FLIGHTDECK_BOARD_CMD`, called as `<cmd> <issue> done ""`: the coordinator's `issue-note.sh`,
  whose REST queue of #242 survives a rate limit. Without it the board is skipped, said once. The
  coordinator tooling stays outside the repository; the script only knows the command's contract.
- **Hardening (issue #287, from the security review of #275).** The tag and `--since` must be
  `vX.Y.Z` (exit 2 otherwise), so neither can reach git as an option or a range. An issue title is
  printed with its control characters turned into spaces (no escape sequence in a dry run). A
  session's `bun run release:close ... --apply` (or `bun scripts/release-close.ts ... --apply`) is
  blocked by the hook guard like `bun run release`: it closes issues on GitHub, so it is the
  coordinator's; the dry run stays open. `bun run release` takes a tag as already made only when
  `git ls-remote` lists exactly `refs/tags/<tag>` on origin (a local tag is anyone's, `pr tag` is
  what gates a tag, and ls-remote matches a suffix, so `x/refs/tags/<tag>` is not it); an origin it
  cannot ask is an error, not "absent". It reads a version from main only when it is `x.y.z`.
