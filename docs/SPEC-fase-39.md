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
- [plugins](https://opencode.ai/v2/docs/plugins): `.opencode/plugins/*.ts` and `plugins` entries run code in the server;
  "Changes under watched config directories reload automatically".
- [commands](https://opencode.ai/v2/docs/commands): a command's `` !`cmd` `` blocks "run when OpenCode evaluates the
  command, outside the agent's tool permission flow"; cli/acp: a prompt that "starts with `/` and the name of an
  available command" runs it.
- [policies](https://opencode.ai/v2/docs/policies): `allow`/`deny` statements (`plugin.use`, `mcp.use`, ...); "statements
  from broader configuration are evaluated later"; the inline variable is not placed.
- [mcp-servers](https://opencode.ai/v2/docs/mcp-servers): project `mcp.servers` start at session start; tools are named
  `<server>_<tool>`.

What the docs do not say and the installed binary does (all checked by the probes in DECISIONS, phase 39):

- `OPENCODE_CONFIG_CONTENT` (inline config in the environment) is not in the v2 docs, yet it works in v2.2.5, with the v2
  key (`permissions`, a rule list) and with the v1 key (`permission`, an object). Its rules win over a project
  `opencode.json` that allows everything.
- The permission request is the JSON-RPC request `session/request_permission` (the docs describe the options but do not
  name the method), with options `once` (`allow_once`), `always` (`allow_always`) and `reject` (`reject_once`).
- `session/set_config_option { sessionId, configId, value }` changes `model`, `effort` and `mode` of a live session; the
  docs list the method, not its parameters.
- `OPENCODE_DISABLE_PROJECT_CONFIG=1` (in the binary, not in the docs) removes the project's `opencode.json` and
  `.opencode/` as config sources: no project plugin, MCP server, agent or command loads (ADR 39-1).
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

Third round, after the independent review (DECISIONS, phase 39, "the independent review"): project plugins and MCP
servers load at `session/new` and in every `--standalone` call; `/api/plugin`, `/api/mcp` and `/api/command` do not list
them; inline `plugins: ["-*"]` breaks the providers; inline policies lose to the project's; `OPENCODE_DISABLE_PROJECT_CONFIG=1`
removes all project config (and its `AGENTS.md`); a leading space before `/command` still runs it, a zero-width space does
not; `grep`, `glob` and `read` outside the folder ask; a plain reject ends the turn (`cancelled`); a fork's cost starts
fresh; SIGKILL of `acp` took its shell child (Linux); three `--standalone` calls take 12.4 s next to a live `acp`; an idle
`acp` holds about 110 MB.

Still open, answered at the start of the `opencode-events` area by recording real ACP traffic with the free model into
`apps/daemon/test/fixtures/opencode-acp/` (the fixtures the fake plays back; nothing is invented by hand):

- **6.** The `rawInput` shape of `read`, `edit`, `write`, `glob`, `grep` and `webfetch` (for the name map below).
- **7.** What an update of a child session looks like (docs: `_meta["opencode/child-session"]` and a `<childId>:` tool
  call prefix), recorded in a scratch config that allows a subagent, since the shipped config denies them.

## Design

What this design guarantees, and what it does not: **tool permission rules cannot be outranked, and no code, server,
agent or command from the project loads**. The global and system OpenCode scopes are checked and must be clean; changes to
them during a session stop it. A rule saved or a global file changed between a check and the next tool call is the
accepted residual risk (DECISIONS), covered by the live re-checks and the tripwire.

**Transport: one `opencode acp` process per live session.** The daemon is the ACP client. Each process gets the
session's environment and the injected config, so sessions never share a process. stdin closing ends it.

- `apps/daemon/src/runtime/acp/client.ts`: newline-delimited JSON-RPC 2.0 over injected stdio. Request and response by
  id, notifications, requests from the agent (answered by a handler map; any other method gets "method not found"), a
  timeout per request (30 s, none for `session/prompt`), and failure of every pending request when the output ends. No
  line is logged with its text.
- **The environment of every OpenCode process Flightdeck starts** (ACP, preflight, models): the session's environment
  (`buildChildEnv`, so the Anthropic keys stay stripped) without any `OPENCODE_*` variable of the daemon, plus
  `OPENCODE_DISABLE_PROJECT_CONFIG=1` and `OPENCODE_CONFIG_CONTENT` (below). ADR 39-1.
- `apps/daemon/src/runtime/opencode-runtime.ts`: `OpenCodeRuntime implements AgentRuntime`.
  - `start`: spawn `<opencode> acp`; `initialize` with protocol 1 and `clientCapabilities: {}` (no `fs`, `terminal`,
    `elicitation` or `auth`); `session/new { cwd, mcpServers }` or `session/resume { sessionId, cwd, mcpServers }`; then
    `set_config_option` `mode` (checked: the answer's `currentValue` is our mode, and the `mode` options are exactly
    `flightdeck` and `flightdeck-plan`), `model` and `effort` when given. No `session/prompt` goes before that. 30 s
    timeouts on `initialize` and `session/new`; a timeout or an error fails the session. `auth_required` becomes
    `session.error` `opencode_auth_required`.
  - `send(text, uuid, images)`: `session/prompt` with one `{ type: "image", mimeType, data }` block per image and a text
    block when the text is not empty. **Neutralizing (ADR 39-2):** a text whose `trimStart()` begins with `/` gets a
    zero-width space (U+200B) in front. On the first prompt of a new session (not a resume), the folder's own `AGENTS.md`,
    when present and under 64 KB, goes first as an embedded `resource` block (text only; project config is off, so
    OpenCode does not read it). `uuid` is ignored.
  - `interrupt`: the notification `session/cancel`. When the prompt has not answered 10 s later: `session/close`, kill,
    and a `turn.result` with `isError`.
  - `close`: idempotent; `session/close` with a 2 s timeout, stdin closed, kill 3 s later.
  - Kill: POSIX starts the child in its own process group and kills the group; Windows runs `taskkill /PID <pid> /T /F`.
    Behind an injected killer and injected timers. stderr is ignored (no pipe to fill).
  - **Idle reaper:** after 15 minutes without a turn the process is closed; the next send starts a new one with
    `session/resume` (no replay). An idle `opencode acp` holds about 110 MB.
  - `setModel`, `setPermissionMode`: `set_config_option`. `rewindFiles`, `toggleMcpServer`, `mcpServerStatus`,
    `forkSession` and `judgePermission` are absent: rewind falls back to the git snapshots, the others answer
    `runtime_unsupported`.
  - The Flightdeck MCP server goes in `mcpServers` as `{ name: "flightdeck", command, args, env: [{ name, value }] }`
    with `FLIGHTDECK_SESSION`.

**Events (`apps/daemon/src/runtime/opencode-events.ts`, a pure normalizer with state per session):**

| ACP | Flightdeck event |
| --- | --- |
| the first `session/prompt` of a run | `session.init { claudeSessionId: <OpenCode session id>, model: <current model>, tools: <names seen so far, or []> }`, never `slashCommands` |
| `agent_message_chunk` (text) | `message.delta`, and the text is kept by `messageId` (a chunk without one joins the current message) |
| a new `messageId`, a `tool_call`, or the end of the turn | `message.assistant { blocks: [text] }` with the kept text |
| `tool_call_update` with the complete `rawInput`, or the `toolCall` of a permission request (whichever comes first) | `message.assistant { blocks: [tool_use { id: toolCallId, name, input }] }`, once per call, always before `canUseTool` is called |
| `tool_call_update` `completed` or `failed` | `tool.result { toolUseId, content: <text blocks, truncated like Claude's; an edit with only a diff falls back to `rawOutput` or a short text>, isError: status === "failed" }` |
| `usage_update` | kept: `cost.amount` is the session's running total |
| the `session/prompt` answer | `turn.result { subtype, isError, durationMs, costUsd?: <last session total, absent when no usage_update came>, usage: { inputTokens, outputTokens, cacheReadInputTokens: cachedReadTokens, cacheCreationInputTokens: cachedWriteTokens } }` |
| `config_option_update`, `current_mode_update` | a security check: `mode` options other than our two, or a current mode other than the one set, cancel the turn and fail the session (`opencode_permissions_overridden`) |
| `agent_thought_chunk`, `plan`, `available_commands_update`, `session_info_update`, `_meta` retry and compaction notices | nothing (the turn stays alive) |
| anything with `_meta["opencode/child-session"]`, or a tool call id with a `<childId>:` prefix | nothing; a child's `session/request_permission` is answered `reject` without the broker, also when the session is idle |

- `stopReason`: `end_turn` is `success`; `cancelled` is `error_during_execution` with `isError` (what the Claude runtime
  reports for an interrupt); `max_tokens`, `max_turn_requests` and `refusal` are errors with their own name. A JSON-RPC
  error on the prompt is a `turn.result` with `isError`, and its message becomes a `session.error`.

**Tool names.** The tool name is ACP's `name` field (probe: `shell`, `grep`, `glob`, `read`). The normalizer maps names
to Claude's when the input maps field by field; the input fields come from the recorded fixtures (question 6):

| OpenCode | Flightdeck | Input |
| --- | --- | --- |
| `shell` | `Bash` | `command`, `description` when present, `cwd` kept |
| `read` | `Read` | path to `file_path` |
| `edit` | `Edit` | path to `file_path`, old and new text to `old_string`, `new_string` |
| `write` | `Write` | path to `file_path`, `content` |
| `glob`, `grep` | `Glob`, `Grep` | `pattern`, `path` |
| `webfetch`, `websearch` | `WebFetch`, `WebSearch` | `url`, `query` |
| `flightdeck_<tool>` | `mcp__flightdeck__<tool>` | unchanged (so `run_with_secret`, `finish_card` and `alwaysAsks` apply) |
| other (`execute`, another MCP server's tools, ...) | `opencode:<name>` | unchanged; `risk.ts` rates every `opencode:*` `high` and network |

Writes to the global OpenCode folder (`Edit`, `Write`, or a `Bash` command naming it) are `high` too.

**Permissions: Flightdeck is the gate.** Every OpenCode process runs Flightdeck's own agents and no other. Its
`OPENCODE_CONFIG_CONTENT` is one fixed document (plus `{ "<id>": { "disabled": true } }` for any extra agent the global
scope defines, found by the preflight):

```json
{
  "default_agent": "flightdeck",
  "permissions": RULES,
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

where `RULES` is everything asks, reads, globs and greps inside the folder are allowed, the credential paths `risk.ts`
knows ask, and `question` and `subagent` are denied:

```json
[
  { "action": "*", "resource": "*", "effect": "ask" },
  { "action": "read", "resource": "*", "effect": "allow" },
  { "action": "glob", "resource": "*", "effect": "allow" },
  { "action": "grep", "resource": "*", "effect": "allow" },
  { "action": "read", "resource": "<each credential pattern: *.env, *.env.*, *.pem, *.key, id_*, .ssh/*, .aws/*, ...>", "effect": "ask" },
  { "action": "read", "resource": "*.env.example", "effect": "allow" },
  { "action": "question", "resource": "*", "effect": "deny" },
  { "action": "subagent", "resource": "*", "effect": "deny" }
]
```

- Agent rules come after every config layer and the last match wins (probe), and the built-in agents are disabled. A
  path outside the folder raises `external_directory`, which asks (probe: `read`, `grep`, `glob`).
- `session/request_permission` goes to `canUseTool` with the mapped name and input. Allow answers `once`; deny answers
  `reject`; an aborted signal answers `cancelled`. `always` is never sent: a saved rule beats `ask` (probe).
- **A reject ends the turn** (probe: `stopReason: cancelled`) and OpenCode rejects every other pending request of the
  session, so the runtime cancels the session's other open broker requests at once. The app text for a denied OpenCode
  request says the turn stopped. ACP's reject carries no message.
- **Modes:** `default` sends every request to the broker; `plan` switches to `flightdeck-plan`; `bypassPermissions`
  allows everything, only when the host's switch allows it. `acceptEdits`, `dontAsk` and `auto` are refused for OpenCode
  sessions (`runtime_unsupported`). `--auto` is never passed.
- **No automatic approval** for OpenCode sessions in version 1 (rules and AI judge both off): a person answers every
  request (ADR 39-3).

**Global and system scopes: scanned before any OpenCode process.** `apps/daemon/src/runtime/opencode-scope.ts` reads,
without starting OpenCode, the global config folder (`$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`, from the
child's environment) and the system scope (`/etc/opencode/`, and on macOS the managed preferences). OpenCode is
unavailable on the host (`host.info.runtimes`, doctor, and a refusal `opencode_unsafe_global` naming what was found) when:

- a global config file has a `plugins` entry (other than a removal) or an `mcp` server;
- the global `plugins/` or `plugin/` folder has any file;
- any system or managed config exists.

The scan also returns a fingerprint (path, size and modification time of every file in the global folder and the system
scope). It runs at daemon start, before every preflight, and after every `tool.result` of an OpenCode session: a changed
fingerprint fails the session with `opencode_permissions_overridden`.

**Preflight: checks through OpenCode, once the scan passed.** Before every start and resume, three read-only commands
run in the folder with the session's environment (`--standalone`: a private server that reads that config), in parallel
with a 15 s timeout each (12.4 s measured next to a live `acp` on the Pi):

1. `<opencode> api GET /api/config --standalone`: the sources are exactly the global folder and the inline document;
   anything else refuses `opencode_config_outranks`, naming it.
2. `<opencode> api GET /api/agent --standalone`: `flightdeck` and `flightdeck-plan` exist and each one's rules end with
   its rules exactly, followed only by `deny` rules; the hidden `compaction`, `title` and `summary` are allowed by id. Any
   other visible agent (a global one) is added to the config content as disabled and the check runs again once; if it
   is still visible, `opencode_config_outranks` naming it.
3. `<opencode> api GET /api/permission/saved --standalone`: any saved rule of the folder's project refuses
   `opencode_saved_rules`, showing per rule the action, at most 40 characters of the resource with secrets masked, and the
   exact removal command (`opencode api DELETE /api/permission/saved/<id>`, run in the folder). Flightdeck never deletes
   them.

A passing preflight is cached for 10 minutes per (folder, OpenCode version, config content hash, scope fingerprint);
refusals are not cached. A failure, timeout or unparsable answer refuses `opencode_preflight_failed`. Every refusal text
carries the OpenCode version. No output is logged.

**Tripwire (second line).** A tool call that completes with no permission request for its `toolCallId` cancels the turn
and fails the session with `opencode_permissions_overridden`, naming the tool and a masked command prefix. It never fires
for `failed` calls, after `interrupt()`, or for `Read`, `Glob` and `Grep` inside the folder. It does not reimplement
OpenCode's rule matching.

**Models.** The session's `model` holds `provider/model`, optionally `#variant`. `provider/model` goes to the `model`
option; a variant that is one of the session's `effort` options, or the payload's `effort` (`low` to `max`, 1:1), goes to
`effort`. The effort choice is hidden when `session/new` offers no `effort` option; a failed `set_config_option` fails the
start. `setModel(undefined)` restores the starting model. The list comes from `<opencode> models --standalone`, run in an
empty Flightdeck-owned folder with the same environment rules after the scope scan passed, cached for 5 minutes.

**Session runtime, store and manager.**

- Protocol: `SessionRuntime = z.enum(["claude", "opencode"])`; `SessionCreatePayload.runtime` and `SessionSummary.runtime`
  (optional, `claude` when absent).
- Migration: `sessions.runtime TEXT NOT NULL DEFAULT 'claude'`.
- `SessionManagerOptions.runtime` becomes `runtimes: { claude: AgentRuntime; opencode?: AgentRuntime }`; the session's
  stored runtime picks one in every start, resume and lazy reattach.
- `AgentRuntime.preflight?(cwd, env): Promise<void>` throws a typed `FlightdeckError`. **Wiring:** the manager puts a
  `preparing` placeholder (holding the message queue) in `live` before the first await, so a second send during the
  preflight queues instead of starting a second run. `create`, `resume` and `createResumed` await it and throw the typed
  refusal. A lazy reattach from `send` that fails sets the session to `error` with `session.error { code, message,
  reason, params }` (`reason` and `params` are new optional fields, for the app to translate) and drops the queued text
  with a notice.
- `claudeSessionId` keeps its name and holds OpenCode's session id for OpenCode sessions.
- Version 1 refuses, with `runtime_unsupported`, an OpenCode session created with a persona; the callers that start
  sessions by themselves (board cards, teams, workflows, templates, GitHub start, history resume) keep `claude`.

**Host config and discovery.**

- `config.runtime` keeps its meaning (`claude` or `fake`). New section `opencode: { enabled: boolean (default true),
  executablePath?: string }`.
- The executable is `executablePath`, else `whichOnPath("opencode")`, else `<HOME>/.opencode/bin/opencode` (`.exe` on
  Windows) when it exists. `<opencode> --version` (2 s) must print `opencode v2.`; v1 is unsupported. The version
  verified by this phase is `2.2.5`: a newer one is used, and the doctor warns that it is not verified yet.
- With the `fake` runtime the host offers a fake OpenCode too, so `demo`, `demo:shots` and `e2e` show the picker.
- `host.info` gains `runtimes: [{ kind, available, version?, path?, reason? }]` and the feature `opencode` when available.
- `doctor.ts` gains an `opencode` check: `ok` with version and path; `warn` when missing, disabled, v1, newer than
  verified, or unavailable because of the global or system scope (naming what). Never a failure.

**What an OpenCode session does not have, gated by its runtime.** Hidden or answered `runtime_unsupported`: the MCP
panel, agent files, memory and plugins pages, background sessions, "Claude here" in the terminal, fork (whole or up to a
message), rewind through the runtime (the git snapshots still work), personas. Empty states (they read Claude
transcripts or the history tables by `claudeSessionId`): trace, history detail, review files and changes, telemetry,
names, the summary card and `history.lastActivity`. Skipped: the plan quota gate, the account's `turnEnded`,
`costs.divergences()`, and the automatic approval. Messaging endpoints leave OpenCode sessions out.

**Costs.** Live only: each OpenCode `turn.result` with a `costUsd` goes to the usage ledger (`usage.summary`), and the
session view shows the turn's cost. The Costs page, budgets and alerts read Claude transcripts and do not count OpenCode
spend in version 1 (Later).

**Commands and refusals (protocol, additive).** `runtime.models { runtime: "opencode" }` answers
`{ models: Array<{ id: string; name: string }> }`. Refusals: `runtime_unavailable`, `runtime_unsupported` (with the
feature), `opencode_unsafe_global` (with what was found), `opencode_config_outranks` (with the agent or source),
`opencode_saved_rules` (with the masked rules and commands), `opencode_preflight_failed`, `opencode_auth_required`,
`opencode_permissions_overridden`; all with the OpenCode version where it applies, translated in both languages.
`session.error` gains optional `reason` and `params`.

**App.**

- New session form: a runtime choice (Claude Code, OpenCode) shown only when `host.info` lists OpenCode available; for
  OpenCode, the model list from `runtime.models` (searchable, grouped by provider), the effort choice when offered, and the
  modes `default`, `plan` and (when the host allows it) `bypassPermissions`. Persona picker hidden for OpenCode.
- Session header and list: a runtime badge. The live model switch uses the OpenCode list. The panels above are hidden;
  the `/` menu offers no commands for OpenCode sessions. A denied request's text says the turn stopped.
- Host page: the doctor's `opencode` row; the runtimes in `host.info`.
- Every text in `en.ts` and `pt-BR.ts`.

**Test guard and fakes.** The preload's `opencode` sentinel (done, `opencode-guard`), and the preload clears `OPENCODE_*`,
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` from the test environment. Discovery, the doctor's
probe, the killer and the timers are injected. A daemon with the `fake` runtime runs no discovery; a test or smoke that
starts a daemon with the `claude` runtime sets `opencode.enabled: false` or a missing `executablePath`.
`apps/daemon/test/fake-opencode.ts` is a folder with `opencode` and `opencode.cmd` that forward to
`fake-opencode-main.ts`: it answers `--version`, `models --standalone`, the three `api ... --standalone` calls and the ACP
peer, from a script of fixtures, and logs what it received. Fixtures under `apps/daemon/test/fixtures/opencode-acp/` are
recorded (scrubbed of paths, ids and the model list) or, for shapes the docs define and the shipped config cannot
produce, synthetic with the doc URL in a header.

**The real binary, opt-in.** `scripts/smoke-opencode-real.ts` (`bun run smoke:opencode-real`, never in the suite or CI,
like `smoke:real`) builds the hostile project of DECISIONS in a scratch folder (plugin, MCP server, `*: allow`, an agent
named `flightdeck`, a `/` command, a saved rule) with a scratch `XDG_CONFIG_HOME`, and checks against the real OpenCode:
no marker appears, the preflight refuses the saved rule and passes once it is gone, the first request asks, and a
neutralized `/hello` does not run. Run at each OpenCode upgrade; its pure parts live in `scripts/lib/` with tests.

**Later (phase 40 or issues, for the maintainer to cut):**

- Subagents, personas and team workers on OpenCode; board cards and arena variants.
- Fork of OpenCode sessions (a fork's cost starts fresh, probe), with the forker routed by the stored runtime.
- `acceptEdits` and the automatic approval for OpenCode sessions, with the global folder's paths excluded.
- History import (`session/list` and `session/load`) into the History screen.
- OpenCode in the Costs page, budgets and alerts.
- OpenCode's `question` tool as Flightdeck's question card; the built-in `/compact` and friends.
- An app action that removes the saved rules a refusal lists (confirmed by the person).
- OpenCode's own revert as the rewind of an OpenCode session.
- Project `opencode.json` settings (models, providers) for people who rely on them, once a safe subset can be loaded.

## Tests and criteria

| Area | What must pass |
| --- | --- |
| `opencode-guard` | done: the preload's `opencode` sentinel is first on the test PATH, with a `.cmd` twin; a folder with a real one leaves PATH; plus: the preload clears `OPENCODE_*` and the four `XDG_*` folders |
| `acp-client` | requests and responses by id; notifications; the agent's requests answered by the handler map, anything else "method not found", a handler error without detail; timeouts and `null`; the end of output fails every pending request; close; no message text in a log; spawn over piped stdio and kill |
| `opencode-scope` | the global folder from `XDG_CONFIG_HOME` or HOME of the child env; a `plugins` entry, a removal-only list, a file in `plugins/` or `plugin/`, an `mcp` server, a system config each give their reason or pass; JSONC; the fingerprint changes when a file is added, changed or removed; nothing runs OpenCode |
| `opencode-env` | every OpenCode process gets the session env without the daemon's `OPENCODE_*`, with `OPENCODE_DISABLE_PROJECT_CONFIG=1` and the config content; the config content is exactly the document above, with extra agents disabled by id |
| `opencode-events` | each row of the events table, from the fixtures: deltas and kept text, a chunk without `messageId`, tool_use once and before the permission call, tool results with truncation, errors and the diff fallback, child-session updates and requests, thought and retry notices dropped, `turn.result` with and without `usage_update`, each `stopReason` |
| `opencode-tools` | the name map and input renames per row; `flightdeck_<tool>` to `mcp__flightdeck__<tool>`; an unknown tool is `opencode:<name>`, rated `high` and network; writes naming the global folder are `high` |
| `opencode-permissions` | a request goes to `canUseTool` with the mapped name and input; allow is `once`, deny is `reject` and cancels the session's other open requests, abort is `cancelled`, `always` never sent; `plan` sets `flightdeck-plan`; `bypassPermissions` only when allowed; `acceptEdits`, `dontAsk` and `auto` refused; no automatic approval; a child's request is rejected without the broker; `interrupt` with a pending request ends the turn |
| `opencode-commands` | a text whose `trimStart()` starts with `/` reaches the fake with a zero-width space first, from the app, the queue and messaging; other text unchanged; `session.init` has no `slashCommands`; `AGENTS.md` as the first resource of a new session only, under 64 KB |
| `opencode-security` | a `config_option_update` or `current_mode_update` off our modes fails the session; a scope fingerprint change after a `tool.result` fails it; the tripwire fires on a completed call without a request and never on `failed`, after `interrupt`, or for reads inside the folder |
| `opencode-preflight` | runs only after the scope passed; the three commands in the folder with the session env, in parallel, with their timeouts; an unknown source, a foreign or extra agent (with the one retry), a saved rule (masked, with the commands) and a failure each refuse with their reason and the version; the cache by its key, refusals not cached; no output logged |
| `opencode-runtime` | start: `initialize` with empty capabilities, new or resume with the Flightdeck MCP entry (exact JSON), mode checked before any prompt, model, variant and effort; `auth_required`; init timeouts; images and empty text; interrupt and its 10 s escalation; idempotent close with its timeouts; tree kill on POSIX and Windows through the injected killer; the idle reaper and the resume after it |
| `opencode-discovery` | the executable from config, PATH, then `<HOME>/.opencode/bin`; the version probe; v1, missing, disabled and newer than verified |
| `opencode-models` | `runtime.models` parses `models --standalone`, run in the empty folder with the env rules after the scope passed; the cache; a failure answers `runtime_unavailable` |
| `session-runtime` | the migration; create with `runtime: "opencode"`; resume and reattach use the stored runtime; the `preparing` placeholder (two sends during a preflight start one run); a failed preflight refuses create and resume with its reason, and a failed lazy reattach sets `error` with the reason and params; unavailable and persona refused; the summary carries the runtime; self-started sessions stay Claude |
| `session-runtime-gates` | an OpenCode session skips the quota gate, `turnEnded`, `divergences()` and the automatic approval; MCP, fork and the other runtime-only features answer `runtime_unsupported`; the transcript features give their empty state; messaging leaves it out; its turns with a cost reach the usage ledger |
| `opencode-protocol` | the payload and summary fields, `session.error`'s `reason` and `params`, `runtime.models`, `host.info.runtimes`, the `opencode` feature, every refusal with texts in both languages |
| `opencode-doctor` | the `opencode` check: ok, missing, v1, disabled, newer than verified, unsafe global scope; never a failure |
| `opencode-fake-host` | the fake runtime serves both kinds; `host.info` on a fake host lists OpenCode |
| `opencode-session-ui` | the runtime choice only when available; the OpenCode model list and effort; the three modes; persona hidden; the badge; the hidden panels and empty states; no `/` commands; the denied-request text; both languages; axe clean |
| `opencode-smoke` | `smoke:opencode` starts a daemon with the fake `opencode` on PATH, opens an OpenCode session, sends a prompt, approves a permission over the socket, sees the tool result and a `turn.result` with cost, sends a `/` text and sees it neutralized, interrupts, restarts the daemon and resumes with `session/resume`, and prints `SMOKE OPENCODE OK` |

`smoke:opencode-real` is opt-in and is not an area of the table (it needs the real binary); its pure parts are tested in
the areas above.

**Acceptance criteria:** the usual ones; the proof of concept answers 6 and 7 recorded in DECISIONS; both manuals (a
section on OpenCode sessions: install, what works, what an OpenCode session does not have, why the project's own
`opencode.json` is ignored, how to remove saved rules); the spec-verifier's verdict. By hand at the end of the phase (not
in a test): `smoke:opencode-real` passes on the Pi; one OpenCode session with `anthropic/claude-sonnet-5-5`, two turns with
one shell command approved from the app, the cost shown, interrupted and resumed; the daemon killed during a running
`sleep` shell command leaves no `sleep` behind. Nothing in a test runs the real `opencode` or touches its data or
credentials.
