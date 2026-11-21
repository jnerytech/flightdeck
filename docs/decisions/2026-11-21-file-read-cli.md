# Reading files from a shell (issue #3624)

Slice 1 of the `file` noun in [the CLI-first decision](2026-11-19-cli-first.md).

`flightdeckd file list|read|search|dirs|files` ask the daemon for the file requests the app already makes
(`file.list`, `file.read`, `file.search`, `fs.dirs`, `fs.files`), so the daemon's refusals reach the shell as they
reach the app: a file that may hold a credential, a missing file, a file over 1 MB and a binary file exit `1` with
the daemon's reason and no content. No vault transport is needed. `file write` is the second slice: it changes
files, so it comes with its own high-risk rule, the `--confirm` flag and a security review.

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
