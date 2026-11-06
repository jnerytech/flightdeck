# The Changes panel has a size cap (issue #329)

- **The problem:** nothing limited what the Changes panel read and drew. A new file was read whole,
  `git diff` came whole into the daemon's memory, and every line was rendered, so a 200 MB log or a
  generated bundle could freeze the panel and, before that, the daemon.
- **Stability first, with a marker, not a failure.** A file over a cap is still in the list, with
  its status and counts, and `tooLarge: true` and `bytes` (the size of the new file, or of the
  diff's text); it has no hunks. The protocol fields are optional, so an older daemon parses
  (`DiffFile` in `packages/protocol`).
- **The caps** (`apps/daemon/src/board/diff.ts`): 512 KB per file (`DIFF_FILE_MAX`, a new file or a
  diff, each a parameter of `workingDiff` and `cardDiff` besides the assistant's own 256 KB for new
  files); 4 MB of diff text in all (`DIFF_LIMITS.totalBytes`), after which the later files are only
  listed; and 16 MB of `git diff` output (`DIFF_LIMITS.rawBytes`), read by `gitLimited`, which kills
  git past it. When git was cut, the file it was in the middle of is dropped and every file that was
  not read whole is listed from `--name-status` and `--numstat` (small outputs), so the list is
  complete with exact counts. A new file is read at most up to the cap and its size comes from
  `lstat`.
- **The panel** (`DiffView`, `ChangesPanel`): a "Too large" badge, the size in place of `+0 −0` for
  a new file, a note with the size instead of the lines, and **Show in folder** when the app can
  open files and the host is this machine (`store.canOpenPaths`, as the simple mode does), and the
  file is not deleted. It is *show in folder* and not *open*: the shell refuses to open a file
  whose extension is not on its short list (a `.log` is the typical too-large file), while showing
  a file in its folder skips that list and keeps the other checks. The editor button stays: it
  refuses a file over 1 MB with its own reason. Text is in both dictionaries.
- **The assistant** hides a too-large file like a binary one (`hidden` in `assistant/context.ts`):
  before, its own cap listed a big new file as binary.
- **Security review (nothing high):** the three `git diff` calls put `--end-of-options` before the
  revision, so a base branch that looks like an option (`--output=...`) is a bad revision and not a
  file write; `gitLimited` kills git in a `finally`. Not done here: validating `baseBranch` when a
  project is added or updated (it is only `min(1)`), and `--no-textconv` for the diff (it would
  change what a repository with a textconv driver shows); the first is its own issue (#345). A path with
  characters git quotes may be listed twice when git's output was cut (the unified diff quotes it,
  `-z` does not): cosmetic.
- **Known limits:** the numbers are fixed, not settings. The 512 KB per file counts the diff text
  of the lines (two bytes per line for the marker and the newline), not git's headers. A file cut
  by the raw limit shows `bytes` only when the daemon knows it (a new file); the note then has no
  size. The panel still draws all the lines it is given (up to the 4 MB): a virtualized list would
  be a separate change.
