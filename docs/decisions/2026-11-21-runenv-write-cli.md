# The write side of a card's run environment from a shell (issue #3621)

Slice 2 of the `runenv` noun, after [the read side](2026-11-21-runenv-read-cli.md).

`runenv trust <project> --hash <hash> --confirm`, `runenv start <card> --confirm` and `runenv stop <card>`, over
`runenv.trust`, `runenv.start` and `runenv.stop`. A project's `run.yaml` is a list of commands: trusting it lets the
host run them, and starting a card runs them. So the two verbs that open that door are the app's decision and carry
two guards, and the one that closes it does not.

- `trust` takes the hash of the file the person reviewed (`--hash`, the whole 64-character sha256 that `runenv config`
  prints, never a prefix: the daemon compares it for equality, so a prefix would read as "the run.yaml changed", and a
  short prefix would weaken the check). The daemon refuses a hash that is no longer the file's, so a file that
  changed after it was read is never trusted unseen. `--confirm` is required, with a refusal that says what trusting
  does. The answer is the project's `run.yaml`, as `config` prints it.
- `start` runs the setup and the processes of the card's run and needs `--confirm`. `stop` ends them and needs
  nothing: it grants nothing. Both print the card's state, as `get` does.
- `--confirm` is only a flag the caller types, so it proves nothing against a session that runs the command from its
  own shell. The risk rules are the guard there: `runenv trust` and `runenv start` are **high** (`runenv-risk.ts`,
  `runsAProjectEnvironment`), through a runtime or a shell given the text, and `runenv` joined the nouns whose verb a
  shell expansion may hide (`VERB_NOUNS`), so `fd runenv $A c1` is high as well. `stop` and the reads stay ordinary.
- A daemon that does not answer after one of the three was sent leaves its result unknown: exit `2`, and the
  message says to check with `runenv config` (for `trust`) or `runenv get` (for `start` and `stop`) before trying
  again.
- `--hash` is the flag `persona trust` already has, so the parser's 12-hex-character rule and its refusal text (which
  names the persona list) still run first; `runenvProblem` then requires the full 64 characters and says so. A hash
  that is too short or not hex fails with the persona wording: a known gap, not changed here. `--confirm` and `--hash`
  each belong to their verbs and are refused on the others (`runenvProblem`).
- Not in this slice, and a gap to report: nothing stops a token holder from `trust` or `start` over the wire (the
  daemon takes both from any paired client, as the app does), and the proof of the person's approval of #3439 does not
  cover them.
