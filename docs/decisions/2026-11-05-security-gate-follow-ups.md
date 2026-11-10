# Security gate follow-ups (issue #284)

- **Why.** OpenCode's second review of #279 found four mediums, with no high left.
- **A deleted file keeps its path, and a rename keeps both.** Deleting a guard file (the hook rules,
  the gate), or moving the CI out of `.github/workflows/`, is risky by path, like editing one.
- **Removed lines count.** A removed line that touches a risk area makes its file risky ("removes
  spawn"). A source file that loses any line and still holds risky code at HEAD (`git show
  HEAD:<path>`) is risky too ("edits spawn code"): taking a check out in front of a spawn or a
  delete needs a review as much as adding one. A removal of comments or blank lines only reads
  nothing, except a lone `/*`: without it the lines after it run, so the file's code is read. A
  file moved from a test folder into the code is risky ("moved from tests"), even unchanged. Known
  limits, all needing a deliberate edit: an added lone `*/` can un-comment code that stays as
  context; a content line that reads `-- "…"` or `++ "…"` looks like a quoted header and blocks the
  gate (it never lets anything through); the trailer is the session's own word. Removed lines are keyed by the file's old path (`--- a/`), so a file renamed into a test
  folder or to a non-code extension still counts the checks it lost; the code that stays is read at
  its new path. A deleted file is not read at HEAD, and a file whose HEAD cannot be read (an error,
  an output past the buffer) is risky, never taken as empty.
- **Renames in the log** (the OpenCode review of #286): `git log` detects renames by itself and
  lists only the new path, so a review after a move away from a risky path could never vouch. The
  log runs with `--no-renames`, which lists both sides.
- **Quoted names fail closed.** A name git still quotes with `core.quotepath=off` (a quote, a
  backslash, a control character) defeats the header parsing, so the gate stamps `unknown`. A path
  with " b/" inside it is read exactly from `diff --git a/<p> b/<p>` when both halves match (every
  change but a rename, whose own lines name its paths).
- **A mode change is a permission change on any file,** with or without a code extension (a script
  in `bin/` made executable).
- **runBounded takes its process, timers and kill as deps.** Its tests use a fake process and timer:
  the deadline, the group kill, the exit before it and a child with no pid run with no real wait.
  The real calls left (a program that exits, one that does not exist, the system's kill calls) start
  and end at once.
