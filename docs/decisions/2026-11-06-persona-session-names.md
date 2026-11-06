# A team session is named by its persona, in the person's language (issue #101)

## Context

Team sessions were named "md-server · executora 1" and "md-server · executora 2", so the
maintainer could not tell the security reviewer from the architect without reading the chips. The
names were built in the daemon, in Portuguese. Only the app knows the person's language.

The app also chose a session's label in four different orders:
- the hub: the meta name, then the standard name;
- the palette: the name the session was created with, then the standard name;
- Needs you: the created name, then the folder (the standard name was ignored);
- the team row: the member's name.

## Decision

- **The daemon sends the parts; the app composes the label.**
  - `session_names` gets nullable `team`, `team_role` and `team_number` columns.
  - `Names.setTeam` records them for a coordinator right after it starts.
  - A worker's card carries them before it starts (`Teams.teamOfCard`), so its session is named with
    them from the first moment. After a restart they are read from the stored teams.
  - The display name and the aliases do not change. The address used for messaging stays the
    first alias.
- **`SessionNameInfo`** gets an optional `team` (`name`, `role`, `number`) and an optional
  `standard` mark: the display is still the standard name, with no rename and no Claude Code title.
  An older host sends neither, and the app shows its display name as before.
- **`TeamMember`** gets an optional `number`, stored with the member. Adding a worker no longer
  reads the number back from the name; a team saved before this change falls back to the
  `executora N` in its names.
- **One helper**, `apps/desktop/src/lib/session-label.ts`, decides what a session is called, in this
  order:
  1. the name the person gave in Flightdeck, then a display that is no longer the standard one (a
     rename, or the Claude Code title of #605);
  2. for a team session: the team, then the persona's name in the app's language (from the host's
     `personas.list`, which the app already asks for in its language) and the worker's number. With
     no persona the host lists, the role word stands in, "Executora 2" or "Worker 2". A slug is
     never shown.
  3. the name the session was created with;
  4. the standard name.

  The hub, the palette and Needs you use this helper. The team screen moves to it with its own
  changes (copy id, link, "Open session").
- **Precedence against #627:** #627's merged rule lets a newer, different Claude Code title
  replace an earlier rename made in Flightdeck. That rule stays. The helper shows any non-standard
  display as it is.

## Discarded alternatives

- **The daemon composes the name in its persona language.** It is smaller, but the name would not
  follow the person's language, which the issue asks for.
- **Renaming team members in the daemon** (the member's `name` and its session's display): this
  changes what the coordinator's instructions and about 100 test expectations read, and still
  leaves the language problem.

## Consequences

- Names that are not team names (`project · geral · N`) are still built in Portuguese by the
  daemon. Localizing them follows the same path and has its own issue.
- Labels follow the language the personas were listed in. Changing the app's language shows the
  new language's persona names once the personas are listed again.
