# Fix: bypass permissions, opt-in per host (issue #1711, moved from DECISIONS.md)

- `allowBypassPermissions` (config, default `false`) is a per-host switch. The daemon refuses
  `session.create` in `bypassPermissions` with reason `bypass_not_allowed` while it is off; the
  check is on the mode asked for (a persona that would clamp it to a stricter one does not
  rescue a bypass request). `host.bypass { allow, confirm }` sets it: turning on needs
  `confirm: true` (`bypass_confirm`), turning off needs none. It is limited to the vault
  transports (loopback, Tailscale) like `roots.add`, writes the config file and is read by
  `host.info` (`allowBypassPermissions`; absent on an older daemon, where the app offers no bypass).
- User decision (their machine): with the switch on, `session.setMode` accepts any mode,
  `bypassPermissions` included, and the "never looser than the start mode" rule applies only
  while it is off. `SettableMode` gained `bypassPermissions`; the daemon is what refuses it.
- The Agent SDK only lets a running query switch to `bypassPermissions` if the query was started
  with `allowDangerouslySkipPermissions: true` (typings of `Options`). The daemon sets it for runs
  started while the switch is on; it allows the switch and bypasses nothing by itself. A run that
  was started while the switch was off cannot switch until the session is resumed, and the manual
  says so. The switch is read at each run start, so a resumed session picks it up.
- The app asks every time: on the host page (naming the host), at Create session in bypass
  (host and folder) and in the composer (host and session). The composer offers all modes only
  on a host that allows it; elsewhere it behaves as before. The mode's label changed from "No
  questions" to "Bypass permissions" to match Claude Code's own name.
