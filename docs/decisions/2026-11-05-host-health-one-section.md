# Health and dependencies in one section, read by itself (issue #121, follow-up)

- **One section, one row component.** The dependencies and the doctor were two panels with two looks; `HostHealth` draws both with the same
  icon and word (the doctor's ok, warn and fail map to check, warning and cross; "Warning" and "Failed" are new words). A doctor check a
  dependency already says (Claude Code, the hooks, the folders, the service and its linger) is shown once, as the dependency; the rest
  (configuration, daemon, Tailscale, templates, team tools, version) are under "Checks". The doctor's own panel and its Check button are gone.
- **Read by itself.** The app reads `deps.check` and `doctor.run` together when a host connects (which includes the reconnect after a daemon
  update), when its page opens if the last read is over five minutes old, and on Check again; the time is kept per host and shown as
  "Checked N min ago". The five minutes bounds the cost of opening the page, not how fresh the sidebar mark is.
- **One-click only where the app already has the action.** Install hooks and Update daemon ask first (the same confirmations as before) and
  Add folder takes the person to the allowed folders tab; the first two read the health again, the update through the reconnect. Anything
  that needs sudo or an installer is a command to copy: the app never runs it, and a test checks that those rows have no action.
- **Claude Code signed in** is a required row from what the account card already reads (`signed_in`, `api_key` and `third_party` are fine;
  `signed_out` is missing, with `claude auth login` to copy; unknown, or no claude, is not applicable). No credential file is read.
