# Session names follow the name Claude Code gives (issue #605)

A session started with `claude --name fd-coordinator`, or renamed with `/rename`, showed in
Flightdeck as `flightdeck · geral · 1` while Claude Code's own list showed `fd-coordinator`.

Claude Code writes the name into the transcript: `{"type":"custom-title","customTitle":...}` (from
`--name` and `/rename`) and `{"type":"agent-name","agentName":...}`. The history indexer already
reads every transcript line by line, so it reports the last title of each chunk it reads
(`onTitle`), and `Names.adoptTitle` applies it.

Rules, in `apps/daemon/src/names/names.ts`:

- A `custom-title` beats an `agent-name`; an `agent-name` is the name only while there is no
  `custom-title`.
- The title is kept in `session_titles`, apart from the display name. A title read again (the
  same one) is not applied again, so a rename made in Flightdeck since is not undone by a pass.
- A different title is a newer rename in Claude Code and wins, a Flightdeck rename included.
- A title read for the first time does not overwrite a name the person already gave in Flightdeck.
- The alias follows the title (its slug), next to the old ones; an alias another session has stays
  with it, and the display name still follows the title.
- A title read before the session was named is applied when it is.
- A session with no title keeps its standard name (`project · persona · number`).

A session Flightdeck started is named by its own id; the indexer's Claude id is mapped to it.
