# Activity has no no-host stage (issue #4336)

The Activity board had a `no_host` stage: with no host it showed its own "No host yet" message and an
Add a host button. It could never show. `route-screens.tsx` renders the Add host screen for every
route when there is no host (`state.hosts.length === 0`), before any screen of `ROUTES`, so
`ActivityBoard` is never mounted without one.

## Decision

Remove the stage, the board's branch for it and the `activityBoard.noHost` text in both languages.
The shell owns the no-host state: one Add host screen for every screen is a better answer than a
message per screen, and showing the board's own message would need an exception to that rule for one
screen.

The `loading` stage while the saved hosts are not read (`hostsLoaded` false) stays: this issue does not
touch it. Its precondition is the same, since `hosts` is empty until they are read, so the shell's Add
host screen may pre-empt it too; whether to drop it is the question of a separate change, with the
flash of Add host before the hosts load.

## Discarded

- Show the board's message: needs the shell to let Activity through with no host, for the same
  Add host button the shell already shows.

## Consequences

- Behavior does not change: the stage was unreachable in the app.
- The tests that mounted the board with no host (a state the app cannot reach) are removed; the
  loading stage keeps its tests, in both languages.
- Other screens' own no-host texts stay: some mean "no online host reports this", a different case,
  and each screen's owner checks its own.
