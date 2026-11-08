# Path checks read a step as NTFS does, in one helper (issue #1064)

The review screens refused `.git` under its NTFS spellings (#1034), but the permission classifier
(`apps/daemon/src/permissions/sensitive-paths.ts`: `isControl` and `credential`) still compared
each step of a path by its plain lower-cased name. On Windows, `GIT~1/hooks/pre-commit`,
`.git::$INDEX_ALLOCATION/config` and `.git./hooks/x` reach the same files, so a standing write
permission could be matched against a name that hid a control file, and a read rule against a
name that hid a credential.

## Decision

- One helper, `ntfsName(step)` in `apps/daemon/src/ntfs-name.ts`, says what a step is called on the
  disk: lower case, no stream after a colon, no trailing dots or spaces, and the 8.3 short name of a
  dotted folder (`GIT~1`, `CLAUDE~1`, `SSH~1`) turned back into its name (`.git`, `.claude`,
  `.ssh`).
- `pathParts` maps every step through it, so `isControl`, `credential` and everything derived from
  the lists see the same spellings. `isGitDir` in the review code is now `ntfsName(name) === ".git"`.
- A step of only dots and spaces (`..`) is left alone.

## Limits and cost

- A short name keeps the first six letters of the name, so a folder with a longer name
  (`.flightdeck`, `.terraform.d`) is not recognised by its short form. The folders the lists name
  with more than six letters are rare; if one matters, the list gains an entry for its short form.
- A step like `readme~1` is read as `.readme` and a step `foo:bar` as `foo`. Both can only make a
  check refuse or ask more, never allow, and the false positives are rare names.
- Only the stream and short-name spellings are new here; HFS+ ignorable Unicode stays out (#1034's
  review: low, macOS only).
