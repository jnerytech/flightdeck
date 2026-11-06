# Revoking trust tells the live sessions that loaded the setup (issue #463)

A session started while its project was trusted keeps the project's hooks, MCP servers and settings
until it ends. Revoking does not stop it (a person may be mid-work); it says so.

- Each live run remembers whether it was given the project's setup (`trustedAtStart`). A live run is
  stale when it was, and its folder is not trusted now.
- Every `session.summary` of a stale session carries `trustStale: true` (absent otherwise). The
  trust commands (`set`, `state`) call `trustChanged()` after a change, so the watchers hear it at
  once, for a revoke and for a trust given again.
- `project.trust.set` and `project.trust.state` answer with `staleSessions: n` (absent when none):
  the live sessions inside the folder that are stale.
- The session screen shows "Trust removed. This session still runs with the hooks and MCP servers
  it loaded. Restart it to apply." with **Restart session**, which closes the session and resumes
  it (a resumed run is given the trust of now). The trust panel says how many sessions are still
  stale. Both texts exist in both languages.

Not done: a restart is the person's click, never the daemon's. A session in a nested folder of a
revoked project counts under every folder above it.

Known limits (security review, all low):

- Only `project.trust.set` tells the watchers at once. A trust that stops covering a folder for
  another reason (`roots.add` puts a root under a trusted record, a rescan of a folder) is counted
  by `staleSessions` straight away, but the `trustStale` mark waits for the session's next summary.
- Revoke, then trust again: the mark clears, though the session still runs with the setup it loaded
  when it started (the person trusted again knowingly).
- An OpenCode session reads no trust decision (`opts.trust`), yet it is marked after a revoke; the
  restart changes nothing for it. OpenCode's project configuration is switched off by the host's
  environment, not by this trust.
- Restart closes the run: the turn in flight is aborted, queued messages are dropped and pending
  permissions are cancelled (never allowed). The button does not say so.

