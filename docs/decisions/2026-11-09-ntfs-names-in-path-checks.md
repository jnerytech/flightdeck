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
  `.ssh`). `isGitDir` in the review code is now `ntfsName(name) === ".git"`.
- `isControl` and `credential` read a path in two ways and refuse it when either matches: as
  written (a POSIX file `host:8080.key` is one name, and `id_ed2~1` still starts with `id_`), and
  with each step through `ntfsName`. The first reading is the old behavior, so the second can only
  add refusals. The security review of the first version (one reading, rewritten steps) found it
  let `host:8080.key` and `ID_ED2~1` through, which this keeps from happening.
- A step of only dots and spaces (`..`) is left alone by `ntfsName`.

## Limits

- A short name keeps the first six letters of the name, and `ntfsName` only turns a dotted folder's
  short name back (`GIT~1` is `.git`). A folder with a longer name (`.flightdeck`, `.terraform.d`),
  a file (`MCP~1.JSN` for `.mcp.json`, `ENV~1.LOC` for `.env.local`) or a folder with no dot
  (`WORKFL~1` for `workflows`) is not recognised by its short form. This was so before; short names
  exist only where a volume generates them.
- `credentialReadGlobs()` builds plain globs for OpenCode's own matcher and does not cover these
  spellings; the code paths that call `credential()` do.
- HFS+ ignorable Unicode stays out (#1034's review: low, macOS only).
