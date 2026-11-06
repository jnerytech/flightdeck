# The model chip and the live effort, part b (issue #109)

- **A new command, `session.setEffort`.** The effort of a running Claude session changes through
  the SDK's flag settings (`applyFlagSettings({ effortLevel })`, `null` clears it), not by
  restarting the session. It is additive: `host.info` announces the feature `session.effort` with
  the other session settings, and the app shows the Effort submenu only when it is there. An older
  daemon keeps the model chip without it.
- **OpenCode does not take it.** Its run has no `setEffort`; the daemon refuses with
  `effort_set_not_live`, and the app keeps OpenCode's plain model list and no effort control.
- **The chip knows the effort only from this view.** The daemon does not report a session's
  effort back, so the chip starts at the model alone and shows "· Medium" after the person picks
  one. The daemon remembers the last effort set, so a resumed session starts with it (not kept
  across a restart of the daemon, as for the arena variants).
- **Models: aliases first, versions under "More models".** The first rows are the aliases
  (Opus, Sonnet, Haiku), which mean the latest of the family; the versions are a fixed list in
  `lib/model-menu.ts`. A session that runs a pinned version shows it checked under "More models",
  and no alias above. The names are read from the id (`claude-opus-5-5` is "Opus 5.5"), so a model
  the list does not know still has a readable chip.
- **A persona's effort is a default, not a cap.** Unlike the persona's permission mode, which only
  ever lowers the session's, the effort a persona suggests is where the session starts; the person
  can raise or lower it from the chip. The security review asked for this to be written down.
