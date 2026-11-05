# Flightdeck — Phase 39 spec (OpenCode as a second runtime)

## Goal

GitHub issue #145: a host runs OpenCode sessions next to Claude Code ones. From the app a person starts an OpenCode
session, follows it live, sends messages, answers its permission requests, switches its model and mode, interrupts and
stops it, and sees what it cost. Any provider and model OpenCode supports can be used (`provider/model`).

OpenCode is the v2 line (`opencode v2.2.5` on the Pi, installed at `~/.opencode/bin/opencode`, with the shared background
service `opencode serve --service` on 127.0.0.1). v1 behavior and v1 docs do not apply.

Prerequisites: phase 1 (the runtime interface and the session manager), phase 7 (the usage ledger), phase 12 (fork and
the git snapshot fallback of rewind), phase 13 (the risk rules and the automatic approval), phase 20 (personas).

Sources (v2 docs, read on 2026-11-04):

- [cli/acp](https://opencode.ai/v2/docs/cli/acp): `opencode acp` "doesn't connect to the shared background service, and
  it doesn't open a network port"; one process serves many ACP sessions and exits when stdin closes. Methods:
  `initialize`, `authenticate`, `session/new`, `session/load`, `session/resume`, `session/fork`, `session/list`,
  `session/close`, `session/delete`, `session/cancel`, `session/prompt`, `session/set_config_option`, `session/set_mode`,
  `$/cancel_request`, `elicitation/create`. `usage_update.cost` "is the session's total cost in USD"; the prompt
  response's `usage` sums that prompt's model calls only.
- [api](https://opencode.ai/v2/docs/api): the HTTP API of the service; every route answers 401 without a token, which only
  comes from the pairing flow (`POST /api/pair`, `GET /auth/connect/{code}`).
- [permissions](https://opencode.ai/v2/docs/permissions): rules `{ action, resource, effect }`, effects `allow`, `deny`,
  `ask`; "the last matching rule wins"; replies `once`, `always`, `reject`; `always` saves a project-scoped allow rule.
- [config](https://opencode.ai/v2/docs/config): `opencode.json(c)` global, project and system (`/etc/opencode/`, highest
  with managed settings); key `permissions`.
- [agents](https://opencode.ai/v2/docs/agents): primary agents `build` and `plan`; subagents `general` and `explore`.
- [models](https://opencode.ai/v2/docs/models): selector `provider/model#variant`; a session keeps its own model.
- [cli](https://opencode.ai/v2/docs/cli): one shared background service per user; `--standalone` runs a private server.

What the docs do not say and the installed binary does (all checked by the probes in DECISIONS, phase 39):

- `OPENCODE_CONFIG_CONTENT` (inline config in the environment) is not in the v2 docs, yet it works in v2.2.5, with the v2
  key (`permissions`, a rule list) and with the v1 key (`permission`, an object). Its rules win over a project
  `opencode.json` that allows everything.
- The permission request is the JSON-RPC request `session/request_permission` (the docs describe the options but do not
  name the method), with options `once` (`allow_once`), `always` (`allow_always`) and `reject` (`reject_once`).
- `session/set_config_option { sessionId, configId, value }` changes `model`, `effort` and `mode` of a live session; the
  docs list the method, not its parameters.
- The v2 docs have no `server`, `sessions` or `cli/run` page (404).

What the docs say and was not checked against the binary: `session/set_mode`, `$/cancel_request` and `authenticate`
(documented on cli/acp, not called by the probes). The `api` page was read word for word up to about 79k of its 283k
characters; the rest only through a summary, so a route or field there may be missing from this spec.

## Proof of concept first

Settled by the probes (recorded in DECISIONS, phase 39): 1 to 5 with the free default model, 8, 10 and 11 with
`anthropic/claude-sonnet-5-5` (four short turns, about 0.04 USD).

- **1. Transport.** ACP over the stdio of `opencode acp` covers everything this phase needs. The service's HTTP API needs a
  token Flightdeck could only get by reading the service's state file, which the rules forbid (the 401 is the evidence;
  the file is not opened). `opencode run --format json` has no way to answer a permission request.
- **2. Process and environment.** The ACP process runs the tools itself: a variable set on `opencode acp` reached a shell
  command of the session. So the sanitized child environment and `FLIGHTDECK_SESSION` reach OpenCode's tools.
- **3. Permissions.** `OPENCODE_CONFIG_CONTENT` with `*: ask` made `shell` ask even with a project `opencode.json` that
  allows `*`. Without it the built-in `build` agent allows everything except reading `.env` files.
- **4. Resume and load.** `session/resume` reattaches without replaying; `session/load` replays the whole conversation as
  `user_message_chunk`, `agent_message_chunk`, `tool_call` and `tool_call_update`.
- **5. Fork.** `session/fork { sessionId, cwd, mcpServers }` answers a new `sessionId`; it takes no cut point.
- **8. Cost.** `usage_update.cost.amount` is the session's running total (0.0361, 0.0397, 0.0416, 0.0433 over four turns).
  The prompt answer's `usage` is that turn's only, with `cachedReadTokens`, `cachedWriteTokens` and `thoughtTokens` when
  non-zero.
- **9. System and managed config** was not probed (it needs root). `opencode debug config --standalone` lists every config
  source with its path, so the preflight refuses any source it does not expect.
- **10. Own agents.** Agents defined in the config content (`agents.flightdeck`, v2 shape) are real primary agents;
  `default_agent` picks one; `{ "disabled": true }` removes `build`, `plan`, `explore` and `general`, leaving the session's
  `mode` options as exactly our two agents. A project `opencode.json` with `*: allow` resolves before the agent's own
  rules, so the agent's `*: ask` wins. With `question` and `subagent` denied the model is not offered them.
- **11. Saved `always` rules beat `ask`.** Answering `always` saved a project-scoped rule with a widened resource
  (`shell`, `echo *`), and the same command in the next turn ran with no request, despite the agent's `*: ask`.
  `opencode api GET /api/permission/saved --standalone`, run in the folder, lists the project's saved rules. (The probe's
  rule and session were deleted.)

Still open, answered at the start of the `opencode-events` area by recording real ACP traffic with the free model into
`apps/daemon/test/fixtures/opencode-acp/` (the fixtures the fake plays back; nothing is invented by hand):

- **6.** The `rawInput` shape of `read`, `edit`, `write`, `glob`, `grep` and `webfetch` (for the name map below).
- **7.** What an update of a child session looks like, so it is filtered out (subagents are denied, so it should not come).

## Design

**Transport: one `opencode acp` process per live session.** The daemon is the ACP client. Each process gets the
session's environment and the injected config, so sessions never share a process. stdin closing ends it.

- `apps/daemon/src/runtime/acp/client.ts`: newline-delimited JSON-RPC 2.0 over a child's stdio. Request and response by
  id, notifications, requests from the agent (answered by a handler), a timeout per request (30 s, none for
  `session/prompt`), and failure of every pending request when the process exits. The client declares no `fs` and no
  `terminal` capability; an `fs/*` or `terminal/*` request from the agent gets a JSON-RPC error. No line is logged with
  its text (prompts and outputs stay out of the logs).
- `apps/daemon/src/runtime/opencode-runtime.ts`: `OpenCodeRuntime implements AgentRuntime`.
  - `start`: spawn `<opencode> acp` with `cwd`, `env` = the session env plus `OPENCODE_CONFIG_CONTENT` (below);
    `initialize` (protocol 1); then `session/new { cwd, mcpServers }`, or `session/resume { sessionId, cwd, mcpServers }`
    when `resume` is set. Then `set_config_option` for `model` and `effort` when given, and `mode` = `plan` for the plan
    permission mode.
  - `send(text, uuid, images)`: `session/prompt` with a text block and one `{ type: "image", mimeType, data }` block per
    image. One prompt at a time (the session manager already queues). `uuid` is ignored.
  - `interrupt`: the notification `session/cancel`; a pending permission request is answered `cancelled`.
  - `close`: `session/close`, then stdin is closed; the process is killed after 3 s.
  - `setModel`, `setPermissionMode`: below. `rewindFiles`, `toggleMcpServer` and `mcpServerStatus` are absent, so the
    existing fallbacks apply (rewind uses the git snapshots, MCP answers that the feature is not live).
  - `forkSession(id, { upToMessageId })`: a short ACP process runs `session/fork`. With `upToMessageId` it is refused with
    `runtime_unsupported`: ACP forks the whole session.
  - `judgePermission` is absent: the automatic approval keeps the host's Claude runtime as its judge (see below).
  - The Flightdeck MCP server goes in `mcpServers` of `session/new` and `session/resume` as a stdio server with
    `FLIGHTDECK_SESSION`, like the Claude runtime does.

**Events (`apps/daemon/src/runtime/opencode-events.ts`, a pure normalizer with state per session):**

| ACP | Flightdeck event |
| --- | --- |
| `session/new` or `session/resume` answered, then the first `session/prompt` sent | `session.init { claudeSessionId: <OpenCode session id>, model: <current model>, tools: [], slashCommands: <names from the last available_commands_update> }` |
| `agent_message_chunk` (text) | `message.delta`, and the text is kept by `messageId` |
| a new `messageId`, a `tool_call`, or the end of the turn | `message.assistant { blocks: [text] }` with the kept text (deltas are not stored, so the full text must be) |
| `tool_call_update` with the complete `rawInput` (status `in_progress`, or the `toolCall` of a permission request) | `message.assistant { blocks: [tool_use { id: toolCallId, name, input }] }`, once per tool call; the first `tool_call` has only `{ cwd }` and is not emitted |
| `tool_call_update` with status `completed` or `failed` | `tool.result { toolUseId, content: <text blocks, truncated like Claude's>, isError: status === "failed" }` |
| `usage_update` | kept: `cost.amount` is the session's running total |
| the `session/prompt` answer | `turn.result { subtype, isError, durationMs, costUsd: <last session total>, usage: { inputTokens, outputTokens, cacheReadInputTokens: cachedReadTokens, cacheCreationInputTokens: cachedWriteTokens } }` (the cached fields only when present) |
| `agent_thought_chunk`, `plan`, `current_mode_update`, `config_option_update` | nothing (the Claude runtime leaves thinking out too) |
| any update whose `sessionId` is not the session's (a child session) | nothing; a child's `session/request_permission` is answered `reject` (subagents are denied, so it should not come) |

- `stopReason` to `subtype`: `end_turn` is `success`; `cancelled` is what the Claude runtime reports for an interrupt;
  `max_tokens`, `max_turn_requests` and `refusal` are errors with their own name. A JSON-RPC error on the prompt is a
  `turn.result` with `isError`, and its message becomes a `session.error`.
- `costUsd` is the running session total, which is what `UsageLedger.record` expects (it subtracts the previous total).

**Tool names.** Flightdeck's risk rules (`permissions/risk.ts`), plain texts, the automatic approval's prompt, persona
tool lists and the tool cards read Claude's names and input fields. The normalizer maps OpenCode's names to Claude's when
the input can be mapped field by field, and keeps anything else as `opencode:<name>` (which the risk rules treat as an
unknown tool). The table is filled from the recorded fixtures (question 6):

| OpenCode | Flightdeck | Input |
| --- | --- | --- |
| `shell` | `Bash` | `command`, `description` when present, `cwd` kept (a command outside the folder must look like one) |
| `read` | `Read` | path field to `file_path` |
| `edit` | `Edit` | path to `file_path`, old and new text to `old_string`, `new_string` |
| `write` | `Write` | path to `file_path`, `content` |
| `glob`, `grep` | `Glob`, `Grep` | `pattern`, `path` |
| `webfetch` | `WebFetch` | `url` |
| other | `opencode:<name>` | unchanged |

**Permissions: Flightdeck is the gate, by construction.** Every OpenCode process runs Flightdeck's own agents and no
other. Its `OPENCODE_CONFIG_CONTENT` is one fixed document:

```json
{
  "default_agent": "flightdeck",
  "agents": {
    "flightdeck": { "mode": "primary", "description": "Flightdeck", "permissions": RULES },
    "flightdeck-plan": { "mode": "primary", "description": "Flightdeck plan", "permissions": RULES + [{ "action": "edit", "resource": "*", "effect": "deny" }] },
    "build": { "disabled": true },
    "plan": { "disabled": true },
    "explore": { "disabled": true },
    "general": { "disabled": true }
  }
}
```

where `RULES` is:

```json
[
  { "action": "*", "resource": "*", "effect": "ask" },
  { "action": "read", "resource": "*", "effect": "allow" },
  { "action": "read", "resource": "*.env", "effect": "ask" },
  { "action": "read", "resource": "*.env.*", "effect": "ask" },
  { "action": "read", "resource": "*.env.example", "effect": "allow" },
  { "action": "glob", "resource": "*", "effect": "allow" },
  { "action": "grep", "resource": "*", "effect": "allow" },
  { "action": "question", "resource": "*", "effect": "deny" },
  { "action": "subagent", "resource": "*", "effect": "deny" }
]
```

- Agent rules are appended after every config layer and the last match wins, so a global or project `opencode.json` that
  allows `*` lands before `RULES` and loses (probe: a project `*: allow` resolved before the agent's `*: ask`). The
  built-in agents are disabled, so their own `allow` rules (`build`'s `question`, `explore`'s `shell` and `webfetch`) are
  gone; the session's `mode` options are exactly `flightdeck` and `flightdeck-plan` (probe).
- After `session/new` or `session/resume` the runtime sets `mode` to `flightdeck` (or `flightdeck-plan`) explicitly, and
  refuses to go on if the `mode` options are anything but those two.
- Everything but reads inside the folder asks (a read outside it is OpenCode's `external_directory`, which asks).
  `question` and `subagent` are denied, so the model is not offered them (probe: Sonnet answered "no question tool" and
  "no subagent tool"). An `elicitation/create` that still arrives is declined; a child session's
  `session/request_permission` is answered `reject`.
- `session/request_permission` goes to `canUseTool` with the mapped name and input, so the broker, the risk rules, the
  persona tool check and the automatic approval work unchanged. Allow answers `once`; deny answers `reject`; an aborted
  signal answers `cancelled`. `always` is never sent: it saves a rule in OpenCode's store that then beats `ask` (probe).
  A deny's message cannot reach the model (ACP's `reject` has none); the session's timeline still shows it.
- The permission mode is applied by the runtime, so a live change needs no restart: `default` sends every request to the
  broker; `acceptEdits` allows `Edit` and `Write` inside the folder without asking; `plan` switches to `flightdeck-plan`
  (`set_config_option mode`) and sends the rest to the broker; `bypassPermissions` allows everything, only when the host's
  switch allows bypass (the session manager already refuses it otherwise). `dontAsk` and `auto` are refused for OpenCode
  sessions with `runtime_unsupported`. `--auto` is never passed.

**Preflight: a session that could skip a question is not started.** Before every start and resume of an OpenCode
session (`AgentRuntime.preflight?(cwd, env)`, awaited by the session manager, which refuses the command with the reason),
the runtime runs three read-only commands in the session's folder with the session's environment and config content.
`--standalone` makes each one run a private server that reads that config, not the background service:

1. `<opencode> api GET /api/agent --standalone`: `flightdeck` and `flightdeck-plan` exist; each one's resolved rule list
   ends with its rules exactly, followed by nothing but `deny` rules (v2.2.5 appends `browser` and `skill` denies); no
   agent other than those two is visible (the hidden internal ones, `compaction`, `title` and `summary`, are allowed).
   Otherwise: `opencode_config_outranks`, naming the agent.
2. `<opencode> debug config --standalone`: every config source is the user's global config folder or a file in the
   session's folder or one of its parents. A system or managed source (`/etc/opencode/`, macOS managed preferences, or
   any other path) refuses with `opencode_config_outranks`, naming the source.
3. `<opencode> api GET /api/permission/saved --standalone`: the project's saved `always` rules (scoped by the folder's
   OpenCode project). Any rule refuses with `opencode_saved_rules`, listing each `action resource`; the text says to remove
   them in OpenCode. Flightdeck never deletes them.

The three run in parallel with a 10 s timeout each (about 2 s each on the Pi). A failure, a timeout or an answer that does
not parse refuses with `opencode_preflight_failed`. No output is logged.

**Tripwire (second line).** A rule can still be saved from OpenCode's own TUI while a Flightdeck session is live. So a
call of a tool whose action asks (`Bash`, `Edit`, `Write`, `WebFetch`, and any other the recorded fixtures show asking)
that completes without a permission request cancels the turn and fails the session with
`session.error { code: "opencode_permissions_overridden" }`. Unmapped tools (`opencode:*`) never trip it: some internal
ones may not go through permissions.

**Models.** The session's `model` holds OpenCode's selector `provider/model`, optionally `#variant`. The runtime splits
it: `provider/model` goes to the `model` option and a variant that is one of the session's `effort` options goes to
`effort`. `effort` from the payload (`low` to `max`) goes to `effort` too. `setModel(undefined)` restores the model the
session started with. The list comes from `<opencode> models --standalone` (one `provider/model` per line; it does not
need the background service), cached for 5 minutes, through a new command (below).

**Session runtime, store and manager.**

- Protocol: `SessionRuntime = z.enum(["claude", "opencode"])`. `SessionCreatePayload.runtime` (optional, `claude` when
  absent) and `SessionSummary.runtime` (optional, `claude` when absent).
- Migration: `sessions.runtime TEXT NOT NULL DEFAULT 'claude'`.
- `SessionManagerOptions.runtime` becomes `runtimes: { claude: AgentRuntime; opencode?: AgentRuntime }`. `create` refuses
  `opencode` with `runtime_unavailable` when the host has none. `startRun`, `resume`, the lazy reattach and
  `createResumed` use the session's stored runtime.
- `claudeSessionId` keeps its name and holds OpenCode's session id for OpenCode sessions (renaming it is not additive).
- Version 1 refuses, with `runtime_unsupported`, an OpenCode session created with a persona, and the callers that start
  sessions by themselves (board cards, teams, workflows, templates, GitHub start, history resume) keep `claude`.

**Host config and discovery.**

- `config.runtime` keeps its meaning (the host's Claude-side runtime: `claude` or `fake`). New section
  `opencode: { enabled: boolean (default true), executablePath?: string }`.
- The executable is `executablePath`, else `whichOnPath("opencode")`, else `<HOME>/.opencode/bin/opencode` (`.exe` on
  Windows) when it exists, with `HOME` read at call time. `<opencode> --version` (2 s timeout) must print `opencode v2.`;
  a v1 binary is reported as unsupported, not used.
- With the `fake` runtime the host offers a fake OpenCode too (`FakeRuntime` serves both kinds, with OpenCode-shaped
  model names), so `demo`, `demo:shots` and `e2e` show the picker.
- `host.info` gains `runtimes: [{ kind, available, version?, path?, reason? }]` and the feature `opencode` when available.
- `doctor.ts` gains an `opencode` check: `ok` with version and path, `warn` when missing, disabled or v1 ("OpenCode
  sessions are not available"). Never a failure: OpenCode is optional. Issue #121's `deps.check` is not built here.

**What stays Claude-only, gated by the session's runtime.** For an OpenCode session: the MCP panel, the agent files,
memory and plugins pages, background sessions, "Claude here" in the terminal, fork up to a message, the account card's
`turnEnded`, the plan quota gate (OpenCode turns spend no Claude plan quota), and `costs.divergences()` (it compares with
Claude transcripts) are skipped or hidden. The automatic approval still works for OpenCode sessions: its judge is the
host's Claude runtime, and when the host has none it answers `ask`, as today.

**Costs.** Live only in version 1: each OpenCode `turn.result` goes to the usage ledger (`usage.summary`), with the
session's model as OpenCode names it, and the session view shows the turn's cost. The Costs page reads Claude transcripts
and does not list OpenCode sessions yet (Later).

**Commands and refusals (protocol, additive).** `runtime.models { runtime: "opencode" }` answers
`{ models: Array<{ id: string; name: string }> }`; refusals `runtime_unavailable`, `runtime_unsupported` (with the
feature), `opencode_config_outranks` (with the agent or source), `opencode_saved_rules` (with the rules) and
`opencode_preflight_failed`, all translated in both languages.

**App.**

- New session form: a runtime choice (Claude Code, OpenCode) shown only when `host.info` lists OpenCode available; for
  OpenCode, the model list from `runtime.models` (searchable, grouped by provider) and an effort choice; the permission
  modes offered are the four OpenCode supports. Persona picker hidden for OpenCode.
- Session header and list: a runtime badge on OpenCode sessions. The live model switch uses the OpenCode list. The panels
  in "Claude-only" above are hidden for OpenCode sessions.
- Host page: the doctor's `opencode` row; the runtimes in `host.info`.
- Every text in `en.ts` and `pt-BR.ts`.

**Test guard.** The preload puts an `opencode` sentinel on the test PATH, the way it does for `claude`: it fails the suite
if run, and the preload aborts if a lookup of `opencode` does not land on it. `HOME` is already a temp folder, so the
`~/.opencode/bin` fallback cannot reach the real one. Discovery (the `--version` probe) and the doctor's probe are
injected, so a test decides what they answer; a daemon with the `fake` runtime runs no discovery; a test or smoke that
starts a daemon with the `claude` runtime sets `opencode.enabled: false` or an `executablePath` that does not exist, the
way it points `claude.executablePath` at one. Tests use `apps/daemon/test/fake-opencode.ts`: a folder with
`opencode` and `opencode.cmd` that forward to `fake-opencode-main.ts`, an ACP peer that plays a script built from the
recorded fixtures and logs what it received.

**Later (phase 40 or issues, for the maintainer to cut):**

- Subagents of OpenCode sessions (`subagent` is denied in version 1; their agents' own rules skip Flightdeck's approval).
- Personas and team workers on OpenCode (the persona body has no system prompt slot in ACP; it would go as an OpenCode
  agent in the config content or as the first message, and its tool list through the name map).
- Board cards and arena variants on OpenCode.
- History import of existing OpenCode sessions: `session/list` (100 per page, `cwd` filter) for the list and
  `session/load` for the replay, into the History screen.
- OpenCode in the Costs page: `opencode stats --json` or the service's session stats.
- OpenCode's `question` tool as Flightdeck's question card (`elicitation/create`).
- OpenCode's own revert (`session.revert.*`) as the rewind of an OpenCode session.

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `opencode-guard` | the preload's `opencode` sentinel is first on the test PATH; running it fails the suite; a lookup that misses it aborts; the `~/.opencode/bin` fallback resolves under the temp HOME only; a `claude`-runtime daemon test with the default config never runs the sentinel |
| `acp-client` | requests and responses by id; notifications; a request from the agent goes to the handler and its answer goes back; `fs/*` and unknown requests get a JSON-RPC error; a timeout; the process exit fails every pending request; no message text in a log |
| `opencode-events` | each row of the events table, from the recorded fixtures: deltas and the kept text per message, tool_use only with the complete input and once, tool results with truncation and errors, child-session updates dropped, thought chunks dropped, `turn.result` with the session total and the token fields, each `stopReason` |
| `opencode-tools` | the name map and the input renames for each row; an unknown tool keeps `opencode:<name>`; the risk rules see `Bash` with its command |
| `opencode-permissions` | the config content is exactly the document above and always injected; `mode` is set to our agent after new and resume, and other `mode` options refuse; a request goes to `canUseTool` with the mapped name and input; allow is `once`, deny is `reject`, abort is `cancelled`, `always` is never sent; `acceptEdits` allows edits inside the folder only; `plan` sets `flightdeck-plan`; `bypassPermissions` only when allowed; `dontAsk` and `auto` refused; the tripwire fails the session for an asking tool and never for `opencode:*`; `elicitation/create` is declined; a child session's request is rejected |
| `opencode-preflight` | the three commands run in the folder with the session env and config content, in parallel; resolved rules that end with ours plus denies pass, anything else refuses `opencode_config_outranks` naming the agent; an unexpected config source refuses naming it; any saved rule refuses `opencode_saved_rules` listing them; a failure, timeout or bad answer refuses `opencode_preflight_failed`; start and resume both run it; no output logged |
| `opencode-runtime` | start runs `<opencode> acp` with the session env and the config content; `session/new` with the Flightdeck MCP; resume uses `session/resume`; model, `#variant` and effort through `set_config_option`; images as image blocks; interrupt cancels; close closes and the process ends; fork whole and `upToMessageId` refused |
| `opencode-discovery` | the executable from config, then PATH, then `<HOME>/.opencode/bin`; the version probe; v1 and missing reported with their reason; `enabled: false` |
| `opencode-models` | `runtime.models` parses `models --standalone`; the cache; a failure answers `runtime_unavailable` |
| `session-runtime` | the migration; create with `runtime: "opencode"` stores it and starts the OpenCode runtime; resume and reattach use the stored runtime; unavailable and persona refused with their reasons; the summary carries the runtime; self-started sessions stay Claude |
| `session-runtime-gates` | an OpenCode session skips the quota gate, the account's `turnEnded` and `divergences()`; MCP and fork-up-to answer `runtime_unsupported`; its turns reach the usage ledger |
| `opencode-protocol` | the payload and summary fields, `runtime.models`, `host.info.runtimes`, the `opencode` feature, the five refusals with texts in both languages |
| `opencode-doctor` | the `opencode` check: ok, missing, v1, disabled; never a failure |
| `opencode-fake-host` | the fake runtime serves both kinds; `host.info` on a fake host lists OpenCode |
| `opencode-session-ui` | the runtime choice only when available; the OpenCode model list and effort; the four modes; persona hidden; the badge; the Claude-only panels hidden; both languages; axe clean |
| `opencode-smoke` | `smoke:opencode` starts a daemon with the fake `opencode` on PATH, opens an OpenCode session, sends a prompt, approves a permission over the socket, sees the tool result and a `turn.result` with cost, interrupts, restarts the daemon and resumes with `session/resume`, and prints `SMOKE OPENCODE OK` |

**Acceptance criteria:** the usual ones, the proof of concept answers 6 and 7 recorded in DECISIONS, both manuals (a section on OpenCode sessions: install, what works, what is Claude-only), and the spec-verifier's
verdict. The real check at the end of the phase (by hand, not in a test): one OpenCode session on the Pi with
`anthropic/claude-sonnet-5-5`, a two-turn prompt with one shell command approved from the app, the cost shown, then
interrupted and resumed; and one refusal seen by hand: a saved `always` rule in a scratch project makes the preflight
refuse with `opencode_saved_rules`. Nothing in a test runs the real `opencode` or touches its data or credentials.
