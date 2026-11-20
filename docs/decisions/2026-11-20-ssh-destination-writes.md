# Removing destinations and importing from ~/.ssh/config from a shell (issue #3537)

Slice 3b of the ssh verbs in [the CLI-first decision](2026-11-19-cli-first.md).

`ssh remove <target> --confirm` and `ssh import apply --alias <name>...`, over `ssh.remove` and `ssh.import.apply`.
They change which destinations a host keeps, and an imported key-file destination carries the `IdentityFile` path a
later connect uses.

- `remove` refuses without `--confirm` before anything is sent, and sends `confirm: true` to the daemon, which asks for
  it too and refuses a destination another one goes through as a jump host. A name that no destination or two
  destinations have is refused first, as for the other verbs. `--json` prints `{id, name, removed}`.
- `import apply` names the `~/.ssh/config` hosts to import, one `--alias` each, at least one and at most 500 (the
  daemon's limit). There is no "import everything": the person reads `import preview` and picks. The CLI prints one
  line per name created or skipped, and `--json` prints the daemon's `{created, skipped}`. A skipped name (it exists,
  is not in the file, or loops through its jump hosts) makes the exit code 1, so a script sees that part of the work
  was not done. The CLI never reads or checks a key path itself: the daemon does.
- `--confirm` joined the flags the ssh parser accepts, for `remove` only; `--alias` is for `import apply` only.
  `--alias` joined the options-with-a-value list the risk rules skip, as `--fingerprint` did in 3a.
- The risk rules rate `ssh remove` and `ssh import apply` high from a session's shell, by the same matching as the
  host key writes (every spelling of the CLI, `bun .../bin.ts`, `bash -c`, options between the words); the reads
  stay ordinary. `--confirm` is only a word the caller types, so the rating is the gate.
- Not in this slice: `ssh save` and `ssh.connect` (3c), and the transport guard of the ssh commands.
