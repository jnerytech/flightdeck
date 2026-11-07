# Three more switches in the account menu: badges, What's new, the checklist (issue #282)

The account menu already had Compact rows. The last comment on #282 asked for the switches that
hide the New and Beta badges, What's new and the setup checklist. Each is a menu checkbox kept on
this computer.

- **Hide New and Beta badges** and **Hide What's new** live in `ShellPrefs` (`lib/shell-prefs.ts`):
  one JSON value under `flightdeck.shellPrefs`, replaced on each change so a reader can tell it
  moved. A missing key, a value that is not a boolean or text that does not parse hides nothing.
- **Hide the setup checklist** is not new state: it reads and writes `SetupSettings.hidden`, the
  same as the hide button on the checklist's row. Its label reuses `setup.hide`, and Settings still
  has the way back.
- Hiding What's new removes the dot on the account row and the "What's new" menu item. The switch
  stays in the menu, so the notes come back with it, and the dialog's own releases link is
  unchanged.
- Hiding badges only hides them: they still expire with the version as before (`nav-badges.ts`).
- Divergence from the issue's list: "compact density" was already in the menu (#474), so nothing
  new was added for it.
