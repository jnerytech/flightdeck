# Bypass permissions on by default (issue #3427)

## Context

Issue #1711 (`docs/decisions/2026-11-03-fix-bypass-permissions-opt-in-per-host.md`) made
`allowBypassPermissions` a per-host switch that is off until the person turns it on, with the daemon
refusing `session.create` in `bypassPermissions` while it is off. The user's rule of 2026-11-19, as
written: "princípio do maior privilégio, por exemplo a sessão sempre é criada com o bypass". This record
reverses the default of #1711 and keeps its guard rails.

## Decision

- **The defaults flip.** `allowBypassPermissions` defaults to `true` and `defaultPermissionMode` to
  `"bypassPermissions"` (`apps/daemon/src/config.ts`). A session that nothing asks to run in another
  mode starts in bypass.
- **A config file that says otherwise keeps its value.** `loadConfig` writes the full parsed config
  only when the file is new or holds no token, so a host whose file was created by a daemon that knew
  the keys holds `allowBypassPermissions: false` and `defaultPermissionMode: "default"` explicitly and
  does not change. A file that lacks a key (written before the key existed, or by hand, with a token)
  gets the new default for that key: that host changes without anyone editing it. There is no
  migration: rewriting a person's explicit choice would be a second reversal that nobody asked for. A
  person who wants the old behavior on such a host turns the switch off (host page or `host.bypass`);
  one who wants the new default on a host that holds `false` turns it on.
- **A host with the switch off never defaults to bypass.** With the switch off, a `session.create`
  that names no mode starts in `default` (the session manager reads the configured default through
  one rule: bypass only while the switch is on). Asking for `bypassPermissions` on such a host is
  still refused with `bypass_not_allowed`, exactly as in #1711.
- **A session Flightdeck opens by itself does not default to bypass.** A board fix-run (`unattended`)
  with no mode starts in `default`. The daemon denies `run_with_secret` there in the tool request, and
  a session in bypass never makes that request, so the default would silently drop that guard for a run
  that reads text from outside (a pull request). A card whose own mode is bypass still gets it, as
  before.
- **The terminal wrapper follows the same switch (`flightdeckd claude`).** It adds
  `--permission-mode bypassPermissions` while the host config allows bypass and defaults to it. A
  mode the person passed (`--permission-mode`, `--dangerously-skip-permissions`) or a stricter mode
  of the persona (`plan`, `default`, `acceptEdits`, `dontAsk`) wins. Print mode (`-p`) gets it too:
  nobody is there to approve. Under root, claude refuses bypass: the launch opens in claude's own
  mode and says so, and `IS_SANDBOX` is never set. A config file the launch had to create (a terminal
  whose `FLIGHTDECK_CONFIG` points at nothing) is not the host's choice, so nothing is added. A mode
  set only in a `settings.json` (`permissions.defaultMode`) cannot be seen from the wrapper and is
  overridden by the flag: the host switch is the way back.
- **Slices of #3427.** This one is the daemon's config and managed sessions. The wrapper
  (`flightdeckd claude` adds `--permission-mode bypassPermissions` unless the person passed a mode) and
  the app and manuals follow in their own PRs. A card or a team that sets its own mode keeps it; one
  that sets none gets the host default.

## What stays

- The per-host switch: `host.bypass { allow, confirm }` and the host page switch. It is the only way
  back to the old behavior.
- The confirm to turn it on (`bypass_confirm`); turning it off needs none.
- A persona only restricts: `plan` (or any mode stricter than the asked one) still wins through
  `clampPermissionMode`.
- `session.setMode` still never loosens a live session to bypass while the switch is off.
- `host.info.allowBypassPermissions` is announced as before; an older daemon without it still makes
  the app offer no bypass.
- Claude Code's own refusal of bypass under root is not changed here; the wrapper slice decides what
  Flightdeck does when it runs as root (fall back to the default mode and say so, never set
  `IS_SANDBOX`).

## Alternatives discarded

- **Migrating existing config files to the new default.** Rewrites an explicit choice; the user asked
  for the default, not for a change to what a person already chose.
- **Refusing a `session.create` with no mode on a host with the switch off but the default mode at
  bypass.** Technically the same refusal as #1711, but it makes every unspecified create fail for a
  person who only turned the switch off. The fallback to `default` is the least surprising reading.
- **Dropping the switch.** Out of scope; the switch is the person's way back.

## Consequences

- New hosts run every unspecified session without permission prompts. The risk graded approval of
  sessions that are not in bypass is unchanged and reached only when a mode is chosen.
- Hosts whose file holds the keys do not change; hosts whose file lacks them do. The slices that
  follow state the new default in the app and the manuals.
- The check loop's per-card default (decision `2026-11-09-check-loop.md`) follows the card's mode, so
  a card that starts in bypass starts with the loop as that record says; the app slice reads it.
