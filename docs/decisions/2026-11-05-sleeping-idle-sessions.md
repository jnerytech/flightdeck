# Sleeping idle sessions (issue #157)

- **Asleep is "idle with no process", not a new status.** A session that is `idle` and has no live runtime is `asleep` (a field of
  `SessionSummary`, computed by the manager). That is exactly how a session a daemon restart left looks, and `send` already restarts
  such a session lazily from its `claudeSessionId`, so waking is the existing path with no new state to carry through every list, filter
  and count. `activeSessionCount` is unchanged: an idle session was never active. The issue's separate "Waking up…" state is not drawn:
  the process starts inside `send` and the message is delivered at once.
- **Sleeping** closes the runtime, keeps the status `idle`, and logs a `session.status` event with the reason `slept`.
- **Who may sleep.** `idle`, with a live process, no queued message, nobody subscribed (the app subscribes to a session it has open),
  and not kept awake by the host: a pinned session, or one that a card's run uses (`Board.hasRunSession`; the issue allows a card's
  session when it has no Run processes or Watch round, this is the stricter, simpler rule). A team coordinator with live workers is
  not special-cased: a team's sessions are ordinary managed sessions and are slept when idle. **Sleep now** ignores the subscription (the
  person asked) but not the host's reasons.
- **The timer** exists only while `sessions.sleepAfterMinutes` is above 0 (default 0, range 0 to 1440): `IdleSleeper` looks every
  30 s and uses an injected clock and timers in tests. `host.sleep` changes it at runtime and keeps it in the config file.
- **Not built:** the Sessions filter "Show asleep" (asleep rows are shown like any idle one, with the word and a moon), the Asleep glyph in
  the state dot (`state-glyphs` is not on this base: the dot is named "asleep"), "paused" in simple mode, and the composer's "Waking up…".
