# The file explorer reads through the review's calls, scoped to the session's repository (issue #506)

## Context

Issue #506 asks for an explorer like Orca's: the session's folder as a tree with git marks, a name
filter, a read-only viewer with a diff toggle, and `path:line` links from the terminal. It must
honor the size cap (#329) and the credential list (#449), and list nothing outside the session's
roots. The research note on #506 compares Orca's and VS Code's explorers and the daemon's existing
calls.

## Decision

- One new command, `file.list {target, dir}`, next to `file.read` in `ReviewFiles`. It shares the
  review's root (the git top level of the session or card, `Changes.resolve`) and its path checks
  (`fileInRoot` and `located`, hardened in #509), so listing, reading and the diff have one boundary,
  enforced by the daemon. The host announces it as `file.list`.
- A listing is one folder: folders first, then files, in natural order. `.git` (any spelling) and
  links that leave the repository or lead into `.git` stay out; a credential is marked `secret`.
  At most 500 entries, with `truncated`.
- The git marks come from the diff the Changes tab already reads and watches (`changes.get`,
  `changes.watch`), not from a new status call. A folder says it holds changes when a changed path is
  under it.
- The app shows the tree in a **Files** tab of the session, next to Changes. The filter works on the
  folders already open.
- The slices: (1) #509, the review reads' security; (2) this tree; (3) the read-only viewer;
  (4) the diff toggle; (5) `path:line` links; (6) opening a file outside Flightdeck, local hosts only.

## Discarded alternatives

- **`fs.files` as it is.** It is bound to the host's `allowedRoots`, not to the session: only the
  app would keep the tree inside the repository, and a session whose git root sits above an allowed
  root could not list its own root.
- **A recursive `tree.get` with `git status --porcelain` per entry.** One call for the whole tree
  with staged and ignored marks, but a recursion cap, a watcher and a new feature to secure. Kept for
  later if one folder at a time proves slow.
- **Monaco, like Orca.** Heavy, its workers fight the Tauri CSP, and editing is not in scope.

## Consequences

- No "ignored" or "staged" mark: the diff has neither. Untracked files show as new.
- Sessions outside git have no tree (`repo_not_git`), as they have no Changes tab.
- `readdir` reads a whole folder before the 500 cap; a folder with millions of entries costs memory
  once per open (security review, low).
