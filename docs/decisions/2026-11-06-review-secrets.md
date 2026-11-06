# Review reads stay in the repository and never show a credential file (issue #509)

## Context

Researching the file viewer (#506) showed two gaps in the review reads the Changes panel uses:

- `file.read` checked the path only lexically (`fileInRoot`) and then followed links, so a link
  inside the session's repository could read a file anywhere on the host. `file.write` already
  resolved links and refused one leading out (`review_path_link`).
- Nothing in `file.read`, `file.write` or the diff (`changes.get`, `changes.updated`, a card's diff)
  consulted the credential list of #449 (`credential()` in
  `apps/daemon/src/permissions/sensitive-paths.ts`). An untracked, not-ignored `.env.local` or
  `id_rsa` went to the app whole, and the editor opened it.

The file viewer of #506 reads through the same calls, so this is fixed first.

## Decision

- `file.read` resolves the file with `realpath` and refuses one outside the repository's real root
  with `review_path_link`. It still reads any target, inside `allowedRoots` or not; only writing
  needs `allowedRoots`.
- A path the credential list names is refused by `file.read` and `file.write` with
  `review_file_secret` (`bad_request`). The check runs on the path asked for and on where its links
  lead, relative to the real root, so `conf/settings.txt -> .aws/settings.txt` is refused too.
- The diff marks such a file `secret: true` (a new optional `DiffFile` field), with no hunks and no
  counts. A new one is never read. A tracked one is marked when its path or its old path (a rename)
  is on the list; git still computes its diff, which is dropped before the budget counts it.
- Review comments (`ReviewComments.add`, which quotes the lines it comments on) run the same two
  checks on either side of the diff. A comment saved on a credential file before this fix lists
  without its quote, as outdated.
- `file.read` opens the resolved path without following a link (`readRegularSized`: `O_NOFOLLOW`,
  regular files only), so a link swapped in after the check is refused. A folder swapped higher up
  the path in that window is still possible, as it already was for `file.write`.
- `parseUnifiedDiff` reads git's quoted names (a name with a quote, a backslash or a control
  character is written in C quotes even with `core.quotePath=false`). Before, such a header was
  missed and its lines went to the file before it, past the secret mark.
- The app shows the **Hidden** mark and a note in place of the diff, and offers no editor. The note
  also replaces any lines a daemon sends with the mark.
- Reverting a credential file stays allowed: it sends no content to the app.

## Discarded alternatives

- **Hiding the file from the list.** The person would not know the session changed a credential
  file. Listing it, without content, says that it changed.
- **A new error code.** `bad_request` with its own reason is enough: the app shows the reason's text,
  and older apps fall back to the daemon's message, which names only the path.
- **Checking only the path asked for.** A link with a harmless name would read the file.

## Consequences

- A protocol addition only (`DiffFile.secret`, reason `review_file_secret`): an older app ignores the
  mark and shows an empty diff for the file; an older daemon sends no mark.
- The list is the one the permission rules use, so the two stay the same. A false positive (for
  example a committed `.env.example`) is hidden too; the person opens it outside Flightdeck.
- The file viewer of #506 inherits both checks through `file.read`.
