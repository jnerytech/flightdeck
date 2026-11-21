# Reading the messages between sessions from a shell (issue #3622)

Slice 1 of the messaging commands: `message history`, `message watch` and `message rules`, over `messages.list`,
`messages.watch` (with the frames it pushes) and `messaging.rules.get`. The write side (`message rules-set`) is the second
slice, and the four app-only rows get their reasons there.

- The verb for `messages.list` is `history`, not `list` as the issue words it: `message list` already prints the sessions
  the asking session can write to (it needs `FLIGHTDECK_SESSION`, and its answer is another request). Reusing the word
  would have changed that command. `history` is also the word `fd history` and `fd quota history` use for a past record.
- The host filter of `messages.list` is `--with-host <name>`, because `--host <name>` already says which daemon the command
  talks to. Together they read "the messages of the laptop, asked from the pi".
- Filters: `--team`, `--session`, `--with-host`, `--status` (`pending`, `delivered`, `queued`, `refused`, `expired`),
  `--days` (1 to 365) and `--limit` (1 to 1000). With none, the daemon returns the newest 200 messages of the last 30 days; a
  host with more needs `--days` and `--limit`. The parser refuses a value outside its range before any request; a
  filter the daemon refuses exits `1` with its reason. These flags are refused on any other `message` verb and any other
  command, so a typo never turns into an unfiltered read.
- `--json` prints the daemon's answer whole as one document (`messages`, or `policy` and `paused`). Without it, one line
  per message: id, time, `from to to`, status, and the reason in parentheses when the message was refused or expired,
  then the text on one line. A reason, when the message has one, follows the status in parentheses. Message text is plain text from another session: control characters are removed, and the
  text is never read as markup.
- `watch` prints one line per frame until Ctrl-C (a relayed message, a loop alert, an idle notice, an updated message).
  On connect the daemon replays the queued outbox as relay frames, so some lines predate the command, and each status
  change of one message prints its own line.
  With `--json` it prints one JSON line per frame, the frame as the daemon pushed it. Exit is `0` after Ctrl-C and `2`
  when the daemon cannot be reached or drops the stream.
- `rules` prints the policy in force as one JSON line and the pairs a loop paused (`none` when there are none).
- `--json` and `--host` apply to these three verbs only. The verbs of a session's tools (`send`, `read`, `list`, `idle`,
  `team`) keep their identity-based behaviour and refuse both flags.
- The three verbs only read, so they get no risk rating. The rules of a session's shell skip `--team`, `--with-host` and
  `--status` as options with a value, as they do for the others.
