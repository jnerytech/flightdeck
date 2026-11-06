# Prompt cache countdown (issue #159)

- **Off by default.** The owner has not decided the default. It is a setting under Settings, Appearance, because Settings has no
  Costs section yet; it moves when one exists. The lifetime is 5 minutes or 1 hour (Claude Code's two cache lifetimes).
- **Where it shows.** The Sessions row and card (digits), the session's tab (the clock icon alone, laid over the tab's corner so
  the strip does not get wider; the time is in its tooltip) and the status line under the message box, next to the model and mode.
  Only for a session that is idle, from the time the host last heard from it. Running, ended and unknown sessions show nothing.
- **Not built: the composer hint.** The issue lists, as optional, a note next to the send button when the session is cold and the
  context is large. It needs the session's context size, which the app does not hold per session; it stays out until a count is
  available, and the tooltip already says what a message costs when the cache is cold.
- **One clock.** Every countdown shares one 1-second timer that runs only while something draws a countdown and the window is
  visible (the manual's Performance rule: no timers when idle).
