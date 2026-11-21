# Reading and writing files from a shell (issue #3624)

Slices 1 and 2 of the `file` noun in [the CLI-first decision](2026-11-19-cli-first.md).

`flightdeckd file list|read|search|dirs|files` ask the daemon for the file requests the app already makes
(`file.list`, `file.read`, `file.search`, `fs.dirs`, `fs.files`), so the daemon's refusals reach the shell as they
reach the app: a file that may hold a credential, a missing file, a file over 1 MB and a binary file exit `1` with
the daemon's reason and no content. No vault transport is needed. `file write` is the second slice (below): it
changes files, so it comes with its own high-risk rule, the `--confirm` flag and a security review.

- `file read` prints the file whole, with no `--max-bytes`: the daemon already refuses a file over 1 MB, so a second
  cap in the CLI would only hide a second limit from the person (open question 3 of the issue).
- The plain output goes through `plain()`, so a tab or another control character in a name or a line becomes a space.
  `--json` goes through `json()`, which keeps the text as the host has it except DEL, the C1 characters and the
  zero-width characters, which it also cleans: the CLI never hands a terminal a file's escape sequences. Text that
  must be byte-exact needs the app or a read on the host itself.
- `--json` has stable keys: `secret` is `false` and a name match's `line` and `text` are `null` when absent.
- `dirs` and `files` take a path of the host. A relative path is resolved against this machine's current folder, and
  with `--host` it is refused, because the folder of another machine means nothing there.
- `--mode` is a value flag of `file search`, so the permission rules that read a shell call know it takes a word.

## Writing: `file write` (slice 2)

`file write <target> <path> --file <path|-> --hash <sha256> --confirm` sends `file.write` with the text of the file
(or of stdin) as it is, and the hash the person read as `expectedHash`. The daemon keeps the rule that decides:
it writes only if the file still has that hash, refuses a credential file and a text over 1 MB, and cannot create a
file (a missing file never has the hash). So the CLI adds no second check of the content.

- `--confirm`, a 64-digit `--hash` and `--file` are required before the daemon is asked, as for `agentcfg write`. The
  flags are `--file` and `--hash`, the names `agentcfg write` and `persona trust` already use; on `file` they move
  into fields of their own so no other command's check reads them.
- A shell line that runs `file write` is high risk (`FILE_RULES`), with the reason that a typed `--confirm` or
  `--hash` is not the person: the app has the person open the file and save it, and a session could otherwise
  rewrite a file another session runs or reads. The other `file` verbs stay ordinary shell commands.
- The reads are not rated: a session's shell can read the files of another target as the app does. A rating of
  reads outside the session's own folder is left to the permission rules, not to this noun.
- A connection that closes after the write was sent exits `2` and says the file may or may not have changed.
