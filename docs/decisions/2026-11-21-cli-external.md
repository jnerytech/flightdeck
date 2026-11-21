# Terminal sessions and names from a shell (issue #3735)

Part of the CLI-first rule (`2026-11-19-cli-first.md`): `cli-first.md` is at the 400-line limit of a doc, so this slice has a file of its own.

`external list`, `external message`, `external watch` and `names list`, over `external.list`, `external.message`,
`external.watch` and `names.list`. `external` lives in the `central/` domain (it owns the sessions of a plain `claude`),
`names list` in `names/`; both take `--host` and `--json`.

- The daemon's reads and its delivery are unchanged. `external.message` already refuses a session that does not exist
  (`session_not_found`) and one with no channel (`external_no_channel`: only a session opened with `flightdeckd claude`
  has one); both are exit `1` with the daemon's text. The CLI refuses an empty text before it connects.
- `--json` prints a small allowlisted row for each session, not the daemon's whole answer: no transcript path, launch id,
  last prompt or plan text, which belong to a person's terminal (the same line `sessions --json` draws). A missing field
  is `null`. `names list --json` prints every key of the name, `null` for the two an older host leaves out.
- `external watch` streams `external.updated` (one line, or one JSON row, for each session) until Ctrl-C, which ends it
  with exit `0`. The permission frames the same watch also pushes are not printed: answering a request is `approve` and
  `deny`.
- `--text` was only `snippet save`'s; it is now also `external message`'s, picked by the command, as `--off` is.
- Risk: `external message` is high from a session's shell (security review, 2026-11-21). The text lands in a terminal
  session as the person's next prompt, with no sender, and a session that runs in bypass mode (the default) acts on it
  without asking. The verb also skips what `message send` applies: the access rules, the loop guard, the size cap and
  the suspension of auto-approve after third-party text. So a session that read hostile content could drive another
  terminal, or its own, and two sessions could message each other with no pause. It is rated like `review send` and
  `team message`. `external list`, `external watch` and `names list` only read and stay ordinary. `send`, which
  `2026-11-19-cli-first.md` leaves ordinary, may deserve the same look: it is a separate question.
