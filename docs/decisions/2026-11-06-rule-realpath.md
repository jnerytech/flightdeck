# A saved rule is rated on the real path behind a symlink too (issue #528)

- **Problem.** The rule check (#384, #395) reads a rule's path as written. Suppose a symlink
  inside the project points outside it, for example made earlier by an approved Bash call. Then
  `Write(notes.txt)` or `Write(src/app-*.ts)` looks narrow, but it reaches the file or folder the
  link points to.
- **Fix.** Before the check, the `permission.respond` handler resolves each reading of each path
  rule with `realpath` (`realPaths` and `realPathOf`). It does this on the same allow-only path
  and with the same limits as the kind lookup of #395: at most 32 readings, 2 s each, and never a
  network path.
  - For an exact path, the whole path is resolved. For a wildcard, only the folders before the
    first wildcard segment are resolved, and the rest is kept (`src/gen/*.ts` with `src/gen` linked
    to `/etc/gen` reads as `/etc/gen/*.ts`).
  - When the real path differs, the rule is rated on both, and the higher level wins.
  - The real path takes the kind of the path it stands for, because `stat` follows the link.
- **Writing it back.** A real path inside the real project folder or the real home is written
  back under the project folder or the home the classifier knows. A project under a linked folder
  (`/home/me/repos` linked to `/data/repos`) therefore rates as before. A link that leaves both
  folders rates as outside the project: medium for a read and high for a write, or high when it
  reaches a credential.
- **Fail closed.** A rule is refused when a reading cannot be resolved: a link to nowhere (a write
  would create the file where it points), no access, a time-out, or a reading past the cap.
- **When the path is missing.** A path not there yet resolves as its parent's real path plus its
  name, so the file a request is about to write keeps getting its rule.
- **Rejected.** Listing the folder under a wildcard to find links among the files it matches
  (`src/app-evil.ts` linked out of `src`). That would cost one lookup per file, with no bound. See
  below.
- **What stays open.**
  - A link made after the rule is saved. That takes an approved write or Bash call, the same
    class as a file replaced by a folder (#395).
  - A link among the files a wildcard matches, inside a real folder: `src/app-*.ts` with
    `src/app-evil.ts` linked outside. Only the folders before the wildcard are resolved.
  - A caller other than the server that gives no `real` lookup rates the rule as written (the
    default). The server always passes one on an allow.
