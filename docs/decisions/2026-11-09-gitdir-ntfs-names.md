# The review keeps `.git` out by its NTFS short name and streams too (issue #1034)

The security review of #1033 noted an old gap in `isGitDir` (issue #509): the review and the search
keep `.git` out by the first step of a path, which was matched in any case and with trailing dots or
spaces. On NTFS the same folder is also reachable as its 8.3 short name (`GIT~1`, when short names
are on for the volume) and through a stream (`.git::$INDEX_ALLOCATION`). Whether a review path can
be chosen by someone other than the person was not settled, and Windows is tested by hand (#534),
so the coordinator decided to close the gap rather than accept it.

- `isGitDir` drops everything from the first colon (a stream is the folder itself, never another
  name), then trailing dots and spaces, then lower-cases, and refuses `.git` and `git~<digits>`.
- The rule is the same on every platform. A folder named `git~1` or `.git:x` on Linux or macOS is
  hidden from the review and the search too: the cost is a rare, harmless false refusal, and a rule
  that depends on the platform is one more thing to get wrong.
- Names that only resemble it stay readable (`.gitignore`, `.github`, `git`, `my.git`, `git~x`,
  `.git~1`), and the first step is still the only step looked at (`src/GIT~1/notes.md` is read).
- No Windows run was possible here: the tests pin the spellings on any platform, and the existing
  Windows-only refusal of a colon in a review path (`fileInRoot`) stays as it was.
