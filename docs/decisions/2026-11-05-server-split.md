# Splitting the server's dispatch (issue #248)

`startServer` holds about 470 lines of closure helpers and one `dispatch` switch of 280 cases
(about 1,300 lines; SonarCloud cognitive complexity 147). The split moves the cases into handler
modules by domain behind a typed registry. It changes no behavior: every ack, refusal, frame and
order stays as it is, and the 119 daemon test files that start a server are the check.

**Module map**

- `src/server.ts` keeps the transport and nothing else: `Bun.serve`, the origin filter, the
  upgrade, `hello` and the token (`currentToken`, the `authed` set, rotation), the pings
  (`pingSeq`), frame decoding, `onCommand` (parse, then `FlightdeckError` to the ack error,
  anything else to `internal`), and `close()`, which keeps releasing every per-connection field.
  It builds the server context and the registry once. A handler never sees an unauthenticated
  socket, because nothing reaches the registry before `hello`.
- `src/server/transport.ts`: `send`, `ackError` and the socket types, moved out of `server.ts` so
  no handler module imports a value from it (no import cycle).
- `src/server/gates.ts`: the feature gates. Today there are 50 accessors of the form
  `if (!opts.x) throw featureOff("x")`. They become one table, option key to feature string, and
  one `need(key)`. The strings reach the app (`daemonFeature` translations), so the table is taken
  from the source as it is, including the four whose names differ: `watch` throws `prWatch`,
  `telemetryOptIn` throws `telemetry`, `runenv` throws `runEnv`, and `pluginsApi()` reads
  `plugins`. A test written before the move pins every pair.
- `src/server/context.ts`: the server context, built once. It holds `opts`, `manager`, `need` and
  the shared view helpers: `central`, `history`, `listed`, `line`, `managedLive`, `externalListed`,
  `warmKeys`, `foldersOf`, `projectPath`, `subscribe`, `terminalSink` and `updateStatus`. The call
  context, one per command, adds the socket, its `ws.data`, a bound `send` and the command id. The
  mutable transport state (`currentToken`, `authed`, `pingSeq`) is not in it; it stays in
  `server.ts`.
- `src/server/dispatch.ts`: `Handler<T> = (payload, call) => Reply<T> | Promise<Reply<T>>`. A reply
  is the ack's data (`undefined` sends a plain ack, as today), or `afterAck(data, then)`. With
  `afterAck` the dispatcher sends the ack and runs `then` in the same synchronous step, which keeps
  the no-gap rule of `session.subscribe`, `sessions.watch`, `external.watch`, `runenv.watch` and
  `run.watch` (ack, replay, then live). The registry's type is `{ [T in CommandType]: Handler<T> }`:
  a lookup that cannot miss (zod already refuses unknown types), and a command with no handler is a
  type error, as a missing case is today. The pre-hook that warms the project keys runs for the
  prefixes `messages.` and `teams.` only, as now (not `messaging.`).
- `src/server/handlers/<domain>.ts`, ten domains, each exporting
  `{ ... } satisfies Partial<Handlers>`. A test fails if a command sits in two domains: a spread
  would let the second silently win.

| Domain | Commands (prefixes) |
| --- | --- |
| `sessions` | `hello` (from an authenticated socket, as today), `session`, `sessions`, `permission`, `external`, `names`, `idle` |
| `host` | `host`, `daemon`, `doctor`, `maintenance`, `roots`, `ui`, `hooks`, `statusline`, `fs`, `file`, `files`, `gate` |
| `board` | `board`, `card`, `project`, `projects`, `boardsync`, `issues`, `github`, `pr`, `watch` |
| `runs` | `runenv`, `run`, `workflow`, `template`, `task`, `automation`, `webhook` |
| `review` | `review`, `changes`, `snapshots`, `rewind`, `trace`, `history` |
| `costs` | `costs`, `budget`, `quota`, `account`, `usage`, `roi`, `telemetry` |
| `security` | `vault`, `actions`, `askpass`, `ssh`, `rules`, `autoapprove` |
| `agents` | `personas`, `plugins`, `mcp`, `memory`, `agentcfg`, `snippets` |
| `messaging` | `messages`, `teams`, `messaging` |
| `terminal` | `terminal`, `bg` |

**What stays as it is in this issue.** Per-connection state stays on `ws.data`: handlers write the
same `unwatch*`, `changeWatchers`, `terminalSink` and `subscriptions` fields as today, and `close()`
keeps owning their release. A disposer set that would replace that list is a separate change.

**Order of the moves.** 17 open branches change `server.ts`, almost all in `session.*`, `hello`,
`host.*`, `board.*`/`card.*`, `boardsync.*`, `github.*`, `projects.*`, `doctor.run`, `fs.files`,
`history.list`, `roi.summary` and `project.trust.*`, plus the new `deps.check` and
`runtime.models`. So the quiet domains move first: `security`, `agents`, `messaging`, `terminal`,
`costs` (without `roi.summary`), `runs`, `review` (without `history.list`). The hot ones (`host`,
`board`, `sessions` and those leftover cases) move last, after the v0.37 rc and the branches have
landed, so a late rebase only meets cases that have not moved yet. Until then the switch remains
as a fallback for the cases not moved, and it is gone by the end.

**Each step.** One `refactor(server-split)` commit per domain. Each step runs typecheck, the test
files that name that domain's commands, and a fixed set (`host-info`, `server`, `protocolo-compat`).
The whole set that reaches `server.ts` runs once at the end, through the slot. No helper is left
uncalled: `need`, `afterAck` and the registry are each covered by a test.

**Exit criteria.** No function under `src/server/` above cognitive complexity 15. `server.ts`
holds only the transport (about 400 lines). The registry is complete by type. The gate test and the
overlap test both pass, and so do the server tests and the smokes.

**Progress (2026-11-05).** The quiet domains have moved: `security` (34 commands), `agents` (44),
`messaging` (20), `terminal` (14), `costs` (25), `runs` (21) and `review` (21), one commit each.
That is 179 of the 280 commands; `server.ts` is down from 2,316 to 1,218 lines. The gate table
also holds the single-name gates that were written inline (`bypass`, `doctor`, `forker`,
`snapshots`, `tasks`, `templates`, `ui`, `updater`, `updates`). `findProjects` names its command
(`projects.scan` or `projects.clone`), so it stays a check of its own. The hot domains wait for
the v0.37 rc.

The cases were moved by a script: `ok(command.type, x)` became `return x`, `command.payload`
became `payload`, and a gate accessor became `server.need(key)`. Typecheck caught three hazards
of that rewrite, and the script now guards each one:
- **A local named like a shared name.** `terminal.settings` and `runenv.watch` declare their own
  `manager`, which is not the session manager.
- **A spread before an accessor.** In `...actions()`, the spread's dot looked like a member
  access.
- **A name used only inside a string.** It must not be taken as a use of `send`.

`afterAck` returns a class instance, not a plain object, because an awaited object with a `then`
method is taken for a promise. `recusas-recurso` now reads the feature names from `server.ts`, the
handler modules and the gate table. It had failed since the gates moved to `need()`, and it is now
part of the fixed set of each step.
