# OpenCode as a second runtime, proof of concept (phase 39)

Probes on the Pi on 2026-11-04 against `opencode v2.2.5`, with the free default model (`opencode/crouton-alpha-free`), in
scratch folders; every probe session was deleted afterwards with `opencode session delete`. No credential or auth file was
read; the service's state file was not opened.

- **ACP over stdio, not the HTTP API.** Every route of the service answers 401 (`{"_tag":"UnauthorizedError"}`) without a
  token, and the token comes from the pairing flow or the service's own state, which Flightdeck must not read.
  `opencode acp` needs neither: per the v2 docs (cli/acp) it runs a private server with no network port.
  `opencode run --format json` streams `step_start`, `text`, `tool_use` and `step_finish` (with `cost` and
  `tokens { input, output, reasoning, cache { read, write } }`) but cannot answer a permission request.
- **What `initialize` announces:** `loadSession`, `promptCapabilities { image, embeddedContext }`,
  `sessionCapabilities { close, delete, fork, list, resume, additionalDirectories }`, `mcpCapabilities { http }`.
  `session/new` answers the session id and `configOptions` `model` (30 models here), `effort` (`minimal`, `low`, `medium`,
  `high`, `xhigh`, `max`, `default`) and `mode` (`build`, `plan`).
- **The tools run in the ACP process**, with its environment: a variable set on `opencode acp` was printed by a shell
  command of the session.
- **Permissions.** Without injected rules, `build` allows everything but `.env` reads, so a shell command ran with no
  request. With `OPENCODE_CONFIG_CONTENT` (not in the v2 docs) holding `*: ask`, either as the v2 `permissions` rule list
  or the v1 `permission` object, `shell` asked through `session/request_permission` with options `once`, `always`,
  `reject` (kinds `allow_once`, `allow_always`, `reject_once`), even with a project `opencode.json` allowing `*`.
- **Tool input arrives late.** `tool_call` (status `pending`) carries `rawInput { cwd }` only; the command is in the next
  `tool_call_update` (`in_progress`) and in the permission request's `toolCall`.
- **Turn end and cost.** The `session/prompt` answer is `{ stopReason, usage { inputTokens, outputTokens, totalTokens } }`,
  after a `usage_update { used, size, cost { amount, currency } }`. The docs say `cost` is the session total; the free model
  reports 0, so this is checked on a paid model at the real check.
- **Resume, load, fork, config.** `session/resume` reattached with no replay; `session/load` replayed the conversation;
  `session/fork { sessionId, cwd, mcpServers }` answered a new id; `session/set_config_option { sessionId, configId, value }`
  changed `model` and `mode` and answered the new `configOptions`; `session/list { cwd }` answered
  `{ sessions: [{ sessionId, cwd, title, updatedAt }], nextCursor }`.
- **`opencode models --standalone`** prints one `provider/model` per line without the background service (about 2 s here).
- **The id keeps its name.** `claudeSessionId` holds OpenCode's session id for OpenCode sessions; renaming the field would
  not be additive.

## Phase 39: second probe round and the permission design

Probes on 2026-11-04 with `anthropic/claude-sonnet-5-5` (four short turns, about 0.04 USD) and with
`opencode api ... --standalone` (no model call). The probe's saved rule and session were deleted afterwards.

- **Own agents in the config content.** `{"agents": {"flightdeck": {"mode": "primary", "permissions": [...]}}}` (v2 shape)
  defines a real primary agent, `default_agent` selects it, and `{"disabled": true}` removes `build`, `plan`, `explore` and
  `general`: the ACP `mode` options were exactly `flightdeck` and `flightdeck-plan`, and `set_config_option mode` switched
  between them. `opencode api GET /api/agent --standalone` resolves the same config (a private server with the caller's
  environment); `debug` and `api` without `--standalone` ask the background service, which never sees the variable.
- **Layer order.** A project `opencode.json` with `*: allow` resolved before the agent's own rules, so the agent's `*: ask`
  is the last match. v2.2.5 appends `browser` and `skill` denies after the agent's rules.
- **Saved `always` rules beat `ask`.** Answering `always` to `echo fd-one .` saved `{ action: "shell", resource: "echo *" }`
  for the folder's OpenCode project, and the same command in the next turn ran with no request. `opencode api GET
  /api/permission/saved --standalone` run in the folder lists exactly that project's rules.
- **`question` and `subagent` denied:** Sonnet answered "no question tool" and "no subagent tool"; no request came.
- **Cost is the session total:** `usage_update.cost.amount` went 0.0361, 0.0397, 0.0416, 0.0433 over the four turns; the
  prompt answer's `usage` is per turn and adds `cachedReadTokens`, `cachedWriteTokens`, `thoughtTokens`.
- **Decision (maintainer's review): ask cannot be bypassed by construction.** Every OpenCode process runs only
  Flightdeck's agents (built-ins disabled), its mode is set explicitly, and before every start and resume a preflight
  checks the resolved rules, the config sources and the project's saved rules; anything that could beat `ask` refuses the
  session with its reason (`opencode_config_outranks`, `opencode_saved_rules`, `opencode_preflight_failed`) instead of
  running and detecting afterwards. Flightdeck never deletes a person's saved rules. The tripwire stays as a second line,
  for a rule saved from OpenCode's own TUI while a session is live.
- **Residual risk accepted (maintainer).** The preflight checks, then the session runs: a rule saved, or a config file
  changed, between the check and the first tool call is not seen by the preflight. The tripwire and the live re-checks
  below are the line for that window.

## Phase 39: the independent review (OpenCode, `flightdeck-handoff/opencode-spec39-review.md`) and a third probe round

Probes on 2026-11-04 in a scratch "hostile" project: a `.opencode/plugins/evil.ts` that writes a marker at import, a
project `opencode.json` with `permissions *: allow`, an MCP server `evil` (a `touch` command), the policies
`mcp.use evil allow` and `plugin.use * allow`, an agent named `flightdeck` with `*: allow` (JSON and markdown), a command
`.opencode/commands/hello.md` with a `` !`touch ...` `` block, and an `AGENTS.md`. Model calls with Sonnet and the free
default model, a dozen short turns; every probe session was deleted.

Findings:

- **Code loads before any check can refuse.** Each `opencode api ... --standalone` call imported the project plugin
  (one marker line per call), and `session/new` imported it and started the project MCP server. So any preflight that
  starts OpenCode in the folder already ran the repo's code.
- **The review's detection endpoints see nothing.** `GET /api/plugin`, `/api/mcp` and `/api/command` answered empty lists
  with the plugin, the server and the command all present (built-ins are not listed either).
- **Inline `plugins: ["-*"]` breaks OpenCode and does not stop the plugin.** It also removed the provider plugins
  (`session/new` failed with `CatalogNotReady`, "No models are available"), and the plugin's import-time code still ran.
  `plugin.use * deny` in the inline config did not stop it either.
- **Inline policies do not outrank the project's.** With the inline `mcp.use * deny` plus `mcp.use flightdeck allow`, the
  project's server `evil` (allowed by the project's own policy) still started, while an extra server passed through ACP
  (`other`) was blocked and `flightdeck` started. (A first `--standalone` run without the `mcp` marker was confounded:
  `--standalone` calls do not start MCP servers.)
- **`OPENCODE_DISABLE_PROJECT_CONFIG=1`** (found in the binary, not in the docs) removes the project `opencode.json` and
  `.opencode/` as config sources (`GET /api/config` lists only the global folder and the inline document): no plugin
  import, no project MCP server, no project command (`/hello` became a plain prompt), our agents intact. It also drops the
  project's `AGENTS.md` instructions (the model did not see them); an inline `instructions` entry did not bring them back.
- **Inline agents beat project agents of the same id**, in JSON and in markdown (`.opencode/agents/flightdeck.md`).
- **Commands.** A prompt `" /hello lead"` (leading space) ran the command's shell block; `"​/hello zw"` (a zero-width
  space first) did not. Project commands appear in `available_commands_update` (`hello`) next to the built-ins `init`,
  `review`, `goal`, `compact`.
- **Outside the folder, `grep`, `glob` and `read` ask** (a request each, with the outside path in `rawInput`).
- **A plain `reject`** fails the tool ("The user declined this tool call") and ends the turn with `stopReason: cancelled`.
- **A fork's cost starts fresh:** the fork's first `usage_update` was 0.0018 USD, not the parent's total.
- **SIGKILL of `opencode acp` took its running shell command with it** on Linux (`sleep 41` gone, no marker). Windows is
  unverified.
- **Cost of the preflight:** the three `--standalone` calls in parallel, next to a live `opencode acp`, took 12.4 s on the
  Pi (all exit 0). An idle `opencode acp` holds about 110 MB of RSS.
- Other switches in the binary (undocumented): `OPENCODE_CONFIG_DIR`, `OPENCODE_DISABLE_FILEWATCHER`,
  `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_DB`.

### ADR 39-1 (B1): code and servers the project loads

- **Context.** OpenCode imports plugins and starts MCP servers from the project's config at session start, before any
  question; a plugin can answer permissions itself. A preflight that starts OpenCode runs that code too.
- **Options.**
  1. *Detect and refuse* through OpenCode (`/api/plugin`, `/api/mcp`): rejected, the endpoints list nothing and asking
     already ran the code.
  2. *Inline removal* (`plugins: ["-*"]`, `plugin.use` and `mcp.use` deny policies): rejected, it breaks the providers,
     does not stop import-time code, and the project's policies win.
  3. *A file scan in Flightdeck before any OpenCode process* (plugins dirs, `plugins` and `mcp` keys up the folder tree):
     works, but reimplements OpenCode's discovery, which can drift with a version.
  4. *`OPENCODE_DISABLE_PROJECT_CONFIG=1` on every OpenCode process Flightdeck starts*, plus a no-process scan of the
     global and system scopes only: one switch, verified with the markers; the cost is the project's own OpenCode config
     (models, providers, agents, commands, instructions) being ignored.
- **Decision: option 4.** Every OpenCode process (ACP, preflight, models) gets `OPENCODE_DISABLE_PROJECT_CONFIG=1` and an
  environment with every other `OPENCODE_*` removed. Before any of them runs, a scan without OpenCode reads the global
  config folder (`$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`, computed from the child's environment) and the
  system scope (`/etc/opencode/`, macOS managed preferences): a `plugins` entry, a file in `plugins/` or `plugin/`, an
  `mcp` server, or any system or managed config makes OpenCode unavailable on the host, with the reason in `host.info` and
  in the doctor. Then the preflight checks that `GET /api/config` lists exactly the global folder and the inline document;
  an unknown source refuses. The session's `AGENTS.md` (the folder's own, text only) is sent as an embedded resource with
  the first prompt of a new session, so project instructions still reach the model without loading project config.
- **Consequences.** A repo cannot load code, servers, agents or commands into a Flightdeck OpenCode session. A person who
  relies on a project `opencode.json` loses it here (the manual says so). The switch is undocumented: `doctor` warns when
  the installed OpenCode is newer than the last verified version (2.2.5), and the opt-in `smoke:opencode-real` replays the
  hostile project at each upgrade.

### ADR 39-2 (B2): commands run shell outside the permission flow

- **Options.** 1. Refuse folders with commands: harsh, and the global and built-in names stay. 2. Neutralize: every text
  block whose `trimStart()` begins with `/` gets a zero-width space first, in the runtime's `send` (the one place every
  caller goes through: the app, the queue, messaging). 3. Both.
- **Decision: option 2,** plus advertising no command (`session.init.slashCommands` is omitted). With ADR 39-1 no project
  command is loaded; neutralizing also covers global commands and a global command that replaces a built-in name. The
  built-in `/compact` and friends are not offered in version 1.
- **Consequence.** The zero-width rule is verified on 2.2.5 only; `smoke:opencode-real` re-checks it.

### ADR 39-3: nobody but a person approves an OpenCode request in version 1

- **Decision.** For OpenCode sessions the automatic approval (rules and AI judge) is off and `acceptEdits` is not offered
  (modes: `default`, `plan`, `bypassPermissions` when the host allows it). A shell command that writes a plugin into the
  global folder cannot be classified reliably, so a person sees every request. Writes into the global OpenCode folder are
  also `high` risk.
- **Live re-check.** After every `tool.result` the runtime re-reads the global and system scopes (stat only) and fails the
  session with `opencode_permissions_overridden` when they changed; a `config_option_update` or `current_mode_update` that
  leaves the `mode` options other than our two, or the current mode other than the one set, does the same.

### The review's majors and minors

| Item | Decision |
| --- | --- |
| M1 child sessions | Accept. Filter on `_meta["opencode/child-session"]` and the `<childId>:` tool call prefix; a child's permission request is answered `reject` without the broker, also when the session is idle. |
| M2 `opencode:*` risk | Accept. Every unmapped tool is `high` and network (never automatic, moot with ADR 39-3); `websearch` maps to `WebSearch`; `flightdeck_<tool>` maps to `mcp__flightdeck__<tool>` so `run_with_secret` and `alwaysAsks` apply; `execute` (Code Mode) stays `opencode:execute`. The tool name is ACP's `name` field (probe: `shell`, `grep`, `glob`, `read`). |
| M3 glob/grep outside | Resolved by probe: both ask outside the folder. Rules unchanged; a fixture pins it. |
| M4 preflight wiring | Accept. The session manager puts a `preparing` placeholder (with the message queue) in place before the first await, so a second send cannot start a second run; `create`, `resume` and `createResumed` throw the typed refusal; a lazy reattach that fails sets the session to `error` with a `session.error` that carries the reason and its params (an additive field) and drops the queued text with a notice. |
| M5 preflight cost | Accept, changed. `GET /api/config` replaces `debug config`. A passing preflight is cached 10 minutes per (folder, OpenCode version, config content hash, global scope fingerprint); refusals are not cached. Refusal texts carry the OpenCode version. The saved rules refusal shows the action and at most 40 characters of the resource with secrets masked, and the exact removal command per rule (`opencode api DELETE /api/permission/saved/<id>`, run in the folder). |
| M6 tripwire | Accept, coarse: trip only on `completed`, only when no permission request carried that `toolCallId`, never after `interrupt()`, never for `read`, `glob` or `grep` inside the folder; the error names the tool and a masked command prefix. No reimplementation of OpenCode's rule matching. |
| M7 reject | Accept. A deny answers `reject`, which ends the turn (probe) and rejects every other pending request of the session, so the runtime cancels the session's other open broker requests; the app text for a denied OpenCode request says the turn stopped. No feedback field was found in ACP's outcome. On `interrupt` the broker's cancel answers `reject` before `session/cancel`; the turn ends either way, and a test pins it. |
| M8 fork and costs | Accept the scope cut: no `forkSession` for OpenCode in version 1 (`runtime_unsupported`). A `turn.result` has no `costUsd` when no `usage_update` came. Budgets and alerts do not count OpenCode spend (Later). |
| M9 transcript features | Accept. Every consumer keyed by `claudeSessionId` that reads Claude transcripts or the history tables (trace, history, review files and changes, telemetry, names, summary, `history.lastActivity`) gets an empty state or `runtime_unsupported` for OpenCode sessions, listed in the SPEC; messaging endpoints leave OpenCode sessions out in version 1. |
| M10 lifecycle | Accept. POSIX: the child in its own process group and `kill(-pid)`; Windows: `taskkill /PID <pid> /T /F`, behind an injected killer. stderr stays ignored (no pipe to stall). `close()` is idempotent, `session/close` has a 2 s timeout, then stdin closes, then a kill after 3 s, with injected timers. An idle reaper closes the process after 15 minutes without a turn (110 MB each) and the next send resumes with `session/resume` (no replay). `initialize` and `session/new` time out at 30 s and fail the session. |
| M11 stranded users | Accept for agents: extra visible agents from the global scope are disabled by id in the config content (two passes, cached) instead of refusing. Saved rules: the refusal gives the exact commands; an app action to remove them is Later. |
| M12 testability | Accept. Synthetic fixtures are allowed for shapes the docs define, each marked with its doc URL; recorded ones are scrubbed (paths, ids, model list). An opt-in `smoke:opencode-real` (never in the suite or CI) runs the hostile project against the real binary at each OpenCode upgrade; `doctor` warns when the version is newer than the verified one. The fake also answers `--version`, `models --standalone` and the three `api ... --standalone` calls. The preload clears `OPENCODE_*` and the `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` of the test environment. |
| m1 | `cancelled` maps to `error_during_execution` with `isError`, like the Claude runtime. |
| m2 | 10 s after `interrupt` with no prompt answer: `session/close`, kill, and a `turn.result` with `isError`. |
| m3 | No text block when the text is empty and images come. |
| m4 | ACP stdio MCP entries are `{ name, command, args, env: [{ name, value }] }`; the exact JSON is tested. |
| m5 | Effort `low` to `max` maps 1:1; the choice is hidden when `session/new` offers no `effort`; a failed `set_config_option` fails the start. |
| m6 | `models --standalone` runs in a Flightdeck-owned empty folder with the session environment rules (project config off), after the global scan passed. |
| m7 | `auth_required` becomes `session.error` `opencode_auth_required` ("run `opencode auth login` on the host"). |
| m8 | Reads of credential paths (the patterns `risk.ts` knows) ask, as extra rules. |
| m9 | No `session/prompt` before `set_config_option mode` answered with our mode as `currentValue`; a resume sets it again. |
| m10 | `tool_use` is emitted before `canUseTool` is called; chunks without `messageId` join the current message; an edit result with only a diff falls back to `rawOutput` or a short text. |
| m11 | Every `OPENCODE_*` of the daemon's environment is removed; the Anthropic key strip stays (OpenCode uses its own stored auth). |
| m12 | `clientCapabilities: {}` (no `fs`, `terminal`, `elicitation`, `auth`); `_meta` retry and compaction notices keep the turn alive and show nothing. |
| m13 | The rules are also set as top-level `permissions`; hidden agents are allowed by exact id (`compaction`, `title`, `summary`). |
| m14 | Session-scoped rules can only come from a plugin or another client; plugins are out (ADR 39-1); another client on the same session is the accepted residual. |
| m15 | `session.init.tools` carries the names the fixtures show, not `[]`, if the app needs them; checked in `opencode-session-ui`. |
| m16 | `session/delete` is never called: resume needs the session; stated in the manual. |
| m17 | Covered by the coarse tripwire (M6): a completed `.env` read without a request trips it. |

- **A parity gap outside this phase.** Claude sessions started by Flightdeck load the project's settings
  (`settingSources` includes `project`), so a repo's Claude Code hooks and MCP servers run there without a question too.
  Worth its own issue.

## Phase 39: proof of concept answers 6 and 7 (recorded fixtures)

Recorded on 2026-11-04 with Sonnet into `apps/daemon/test/fixtures/opencode-acp/` (README there), with the shipped config
and project config off; both sessions deleted afterwards.

- **Tool names and inputs (6).** ACP's `name` is on the first `tool_call` (status `pending`, `rawInput` empty or
  `{ cwd }`) and on the permission request's `toolCall`; later `tool_call_update`s carry only the `toolCallId`, so the
  normalizer keeps the name by id. Inputs: `write { path, content }`, `edit { path, oldString, newString }`,
  `read { path }`, `glob { pattern }`, `grep { pattern }` (a `path` only when outside the folder), `webfetch { url }`,
  `shell { command, cwd }`, `subagent { agent, description, prompt }`. Reads, globs and greps inside the folder raised no
  request. Results come as `content` text blocks plus `rawOutput.metadata` (an edit's has the patch).
- **Child sessions (7),** recorded with a scratch config that allows `subagent`: the child's updates and its permission
  request carry `_meta["opencode/child-session"] = { id, parentID, depth, title }` and a tool call id
  `<childSessionId>:<id>`, on the parent's `sessionId`, as the docs say.

## Phase 39: two probes before the runtime (shipped environment)

- **A global `opencode.json` is a config source of its own.** With `XDG_CONFIG_HOME` pointing at a scratch folder holding
  `opencode/opencode.json`, `/api/config --standalone` listed that file as a `document` with its path, next to the folder
  (`directory`) and the inline document. The preflight now allows the global folder's config files (the ones the scope
  scan reads) and nothing else in it; a test pins it.
- **Saved rules under the shipped environment** (`OPENCODE_DISABLE_PROJECT_CONFIG=1` and the phase's document, free
  model): an `always` answer saved `shell echo *` for the folder's project, `/api/permission/saved --standalone` with the
  same environment listed it, and the same command in the next turn ran with no request. So the switch does not change
  how saved rules apply, and the preflight's check sees them. Rule and session deleted.

## Phase 39: the code review (OpenCode, `flightdeck-handoff/opencode-review-fase39-code.md`, at 10d46fb)

The review read the branch at 10d46fb, before the `opencode-commands`, `opencode-security` and `session-runtime` areas.

- **B1 (no `/` neutralization):** fixed by 825070e (`opencode-commands`). `turn()` prefixes a zero-width space to a text
  whose `trimStart()` starts with `/`. JavaScript's `trimStart` also removes tab, newline, NBSP, em space and BOM.
- **B2 (no second line):** fixed by 9b32ac9 (`opencode-security`):
  - `config_option_update` and `current_mode_update` are checked before normalizing;
  - the global scope is fingerprinted at connect and again after each completed tool;
  - the tripwire fires on a completed call with no request for its id.
  
  A probe showed that OpenCode sends neither update when Flightdeck sets the mode itself. The field name
  `currentModeId` is ACP's and unverified on 2.2.5.

Probes for this round (2026-11-05; no credential read; every probe session deleted):

- `Bun.spawn({ detached: true })` puts the child in its own process group, and `process.kill(-pid)` reaches the group's
  members.
- A v1 `plugin` key in the global `opencode.json` is read: `/api/config` reports it migrated to `plugins`. Neither it nor a
  file in the global `tool/` folder was imported by `/api/config` or `session/new`. Both are still treated as code.
- `session/resume` answers `configOptions`. The `/api/config`, `/api/agent` and `/api/permission/saved` answers were
  recorded as fixtures (`api-*.json`, `resume.jsonl`).
- **A symlink inside the folder that points outside is read with no request.** OpenCode's inside-the-folder test is
  lexical (review M8).
- With project config off, a project `CLAUDE.md` did not reach the model.
- With `OPENCODE_DISABLE_CLAUDE_CODE=1` and `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`, `session/new` never answered (10 s);
  without them it did at once.

| Item | Decision |
| --- | --- |
| M1 leaks on a failed start or a close during start | Accept. No process before the first send. `connect()` checks for a stop after each await and closes a connection that opened late. `fatal()` always closes the connection and aborts the open questions. A failed start runs the preflight once. Tests pin each repro. |
| M2 close can hang, no forced kill, no process group | Accept. On POSIX the agent leads its own process group (`detached`), and `treeKiller` sends the group SIGTERM, then SIGKILL; it falls back to the process when the group is gone. Windows keeps `taskkill /T /F`. `close()` kills after 3 s, forces 2 s later, and stops waiting 5 s after that. Whether a tool's child survives the stdin-EOF exit is the real check's "daemon stopped during `sleep`". |
| M3 the read loop dies | Accept. A throwing handler and a message that is not an object are logged, with no text, and skipped. |
| M4 a stale escalation timer | Accept. A second interrupt does not set a second timer. An escalation is tied to its turn's number and does nothing once that turn ended. |
| M5 the reaper is not armed without a turn | Accept, by spawning lazily: no process exists until the first send. The manager already ran the preflight for its typed refusal. |
| M6 the scope scan misses keys and folders | Accept. `plugin` (v1) counts like `plugins`. Both `mcp` forms are read. A `plugins`, `plugin` or `mcp` of an unexpected shape fails closed. `tool/` and `tools/` count as code folders. An allowlist of the global folder was rejected: OpenCode keeps other files there (`tui.json`, agents, commands). Commands are neutralized (ADR 39-2), and global agents are disabled by id. The stronger option, an empty `XDG_CONFIG_HOME` per child, stays open for the maintainer: it costs the person's global models and providers. |
| M7 the canary's rule is weaker than the preflight's | Accept. The canary uses the preflight's `unexpectedSource`. Only 2.2.5 itself is `verified`. Discovery keeps the executable's size and time, and the preflight refuses `opencode_changed` when they differ: the daemon checks OpenCode again on restart or from the doctor. |
| M8 lexical "inside the folder" | Accept (confirmed by the probe). `read`, `glob` and `grep` ask in OpenCode. The runtime allows them without a question only when the real path is inside the folder's real path and is not a credential path (`risk.ts`'s `credential`, now exported). A path that does not exist asks. |
| M9 tests and fixtures | Accept. The recorded `/api/*` and resume answers are fixtures, and a test passes them through the preflight. The preload scrubs `OPENCODE_*` and the XDG config, data, state and cache folders. The events normalizer still returns nothing for `config_option_update`; the runtime checks it before normalizing (B2). |
| m1 the `--version` env and timeout | Accept: the OpenCode env and 5 s. |
| m2 prototype keys as tool names | Accept: `Object.hasOwn`. |
| m3 the risk rule for the global folder is lexical | Reject for v1. A person answers every OpenCode request (ADR 39-3), so it is an extra signal only. The live scope fingerprint catches the write itself. |
| m4 refusal text | Accept. An unknown plugin entry is named "(unknown entry)", never by its options. Masking also covers runs with `.`, `/`, `+` and `=` padding, and actions too. A saved rule whose id is not plain is left out of the commands. |
| m5 permission edges | Accept. The question is registered before the card's barrier. A stopped run answers `cancelled` without asking. `close()` aborts the open questions. A request is asked with the fullest input seen for its id. |
| m6 an interrupt before the turn starts | Accept. It ends the waiting turn as cancelled, with no prompt. On an idle run it changes nothing. |
| m7 preflight bookkeeping | Accept: concurrent checks of one key share one run. Reject the env parameter: the daemon gives the runtime, the preflight and the scan the same base env (one place in `main.ts`). |
| m8 Windows paths | Accept: `USERPROFILE` first on Windows. The system and managed folders on Windows and macOS stay "unverified on this OS" in the doctor and the manual. |
| m9 the real `auth_required` shape | Reject for now. Recording it needs a provider without a login, and changing logins is out of bounds. The message match stays; `smoke:opencode-real` records it when it shows up. |
| m10 `OPENCODE_API_KEY` stripped | Accept: it passes through (a provider credential, not a switch). |
| m11 plan mode lets shell ask | Keep. A command still asks a person; the UI text says plan mode blocks edits only. |
| m12 Claude Code compatibility switches | Reject: setting them made `session/new` hang. `CLAUDE.md` was not read with project config off anyway. |
| m13 quadratic `linesOf` | Accept: it keeps its scan offset (refactor). |
| ADR claims with no code | B1, B2 and the typed `session.error` (653014019) now have code. The `preparing` placeholder was not needed: the run's start is synchronous and its preflight runs inside it, so a second send queues on the live run (a test pins one start). The automatic approval gate, the messaging exclusion, `runtime.models`, the doctor row, the UI, the fake `opencode` and both smokes are the remaining areas. |
- **An empty `XDG_CONFIG_HOME` per OpenCode child (the stronger M6 option): rejected (maintainer).** The person's global
  config stays: the scope scan and the preflight already refuse global plugins and MCP servers, and losing the person's
  global models and providers would make the runtime useless for them.

## Phase 39: OpenCode is opt-in per host

- **Decision:** `opencode.enabled` defaults to `false`. Discovery runs the OpenCode binary (`--version`, the canary's
  `api --standalone`), so a host that turned nothing on runs no third-party program at start. The doctor only looks the
  binary up (no run) and says how to turn it on (`"opencode": { "enabled": true }` in the host config). With the `fake`
  runtime (demo, e2e) a fake OpenCode is always offered.
- **Why not on by default:** it would run OpenCode at every daemon start on every host that has it, and in every test that
  starts a daemon with the `claude` runtime (the preload's `opencode` sentinel would fail them).

## Phase 39: the session UI

- **`session.summary` carries `runtime`.** The sidebar and the session page read the summary event, not `session.list`,
  so the event gets an optional `runtime` (set for an OpenCode session only; an older app ignores it). Not in the
  `opencode-protocol` row; added with `opencode-session-ui`.
- **Claude Code's panels are dropped by SessionView itself.** An OpenCode session's `claudeSessionId` is OpenCode's
  `ses_...` id, so "Open in terminal" (`claude --resume`), the timeline (Claude's checkpoints), the persona switch and the
  recap would act on a Claude session that does not exist. SessionView leaves them out, with the model switch, fork and
  `acceptEdits`, when `runtime` is `opencode`; the screens keep passing them unchanged.
- **Effort levels are shown as their ids** (`low` ... `max`), as the arena form already does.
- **Not done in this area:** the empty states of the hidden panels (they are not drawn, so there is no empty state to
  show) and axe on the new form, which runs with `demo:shots` at the phase's end (the slot was jammed). No `/` commands
  needs no UI code: OpenCode's `session.init` has no `slashCommands`.

## Phase 39: the smokes

- **`smoke:opencode` runs in CI** with the other smokes: the daemon in-process, the fake `opencode` first on its PATH. The
  fake records each ACP request (method and prompt text) in its own log (`FAKE_OPENCODE_ACP_LOG`), which is how the smoke
  sees the `/` text arrive with a zero-width space, the `session/cancel` and the `session/resume` after the restart.
- **`smoke:opencode-real` runs the daemon as its own process.** A daemon started inside the smoke names `Bun.main` (the
  smoke) in the Flightdeck MCP entry it gives OpenCode, so OpenCode ran the smoke a second time as that server, which never
  answered, and `session/new` timed out after 30 s. A host runs the daemon itself, so nothing changes in the product.
- **Probe (2026-11-05): the background service loads the project config.** `opencode session list` without
  `--standalone`, run in the hostile project with `OPENCODE_DISABLE_PROJECT_CONFIG=1`, was answered by the person's
  `opencode serve --service`, which never sees the caller's variables: the project's plugin and MCP server ran in it (their
  markers appeared). The same calls with `--standalone`, and `opencode acp`, ran none of them (no marker in a plain folder,
  a git one, the hostile one and the hostile git one). The daemon only runs `acp` and `--standalone` calls; the smoke's
  cleanup (`session list` and `session delete`) uses `--standalone` too, and the manual's saved-rule commands carry it.
- **OpenCode makes a session even when `session/new` times out**, so the real smoke deletes every session of its scratch
  project at the end instead of the ids it saw.
- **30 s for each call that boots OpenCode's private server** (`OPENCODE_API_TIMEOUT_MS`: the preflight's three checks,
  the canary, `models`). The real smoke found it: on the Pi 5 at load 15 to 20, the three checks in parallel took 8 to
  15 s each, and `/api/agent` passed the old 15 s limit (exit 124), so the session was refused with
  `opencode_preflight_failed`. It only matters when the host is slow; a session start already waits for the checks.
  Proposed for phase 40: one private server per preflight (`opencode serve` with Flightdeck's environment, three HTTP
  GETs) instead of three boots, which would also cut the CPU of every start by about two thirds.
- **The pure parts** (the hostile project, the options it answers with, the saved rules' ids, `--model`) are in
  `scripts/lib/opencode-real.ts` with `scripts/test/opencode-real.test.ts` (scope `opencode-real`, not a row of the table).

## Phase 39: the spec-verifier's round (2026-11-05)

Fixed after its report:

- **`AGENTS.md` followed links** (its blocker): a repo's `AGENTS.md` linked to `~/.aws/credentials` would have gone to the
  model on the first prompt. It is now sent only when its real path is inside the folder's and is not a credential (the
  check reads, globs and greps already had); otherwise it is skipped and the timeline says so.
- **The app pieces of the spec:** the model list grouped by provider, in the form and in the live switch of an OpenCode
  session (the switch had been hidden with a wrong reason: `setModel` works for OpenCode); the badge in the hub's cards and
  list; the text when a denial stopped the turn; the `AGENTS.md` line or its skipped notice; no Changes, Time, Trace or
  Messages tab (they read Claude Code's transcript, or messaging, which OpenCode sessions stay out of). The timeline stays,
  as the spec says: snapshots are taken on every turn edge whatever the runtime, so the git-snapshot rewind works (its fork
  answers `runtime_unsupported`).
- **The unsafe scan names what it found** in the doctor's row (CLI and host page), with the paths.
- **macOS managed preferences** (`/Library/Managed Preferences`, and the user's folder in it) are scanned by default, and
  any file in the system folder is a finding, not only the three config names.

Decided as they are:

- **The model list is a native select**, grouped by provider; its type-ahead is the search.
- **Effort is offered for every OpenCode session.** Whether OpenCode offers an `effort` option is known only after
  `session/new`, after the form; the runtime sets it only when the option exists.
- **The host page shows OpenCode through the doctor's row** (available, version, reason and findings), not a separate
  `host.info.runtimes` block.
- **The scope fingerprint covers the config files and the code folders**, not every file of the global folder. A global
  agent or command added mid-session changes nothing a running session may do: our agents are inline and beat same-id
  ones, other agents are disabled at the preflight and a mode switch fails the session, commands are not offered and `/`
  is neutralized.
- **The preflight's cache key has no config-content hash:** the content is decided by the checks themselves (the extra
  agents they disable) from the same folder, OpenCode version and scope fingerprint the key holds.
- **The usage ledger and the account:** an OpenCode turn's cost goes to `usage.record` like a Claude turn's; the Costs
  page, budgets and quota for OpenCode stay in phase 40 (the scope cut). `turnEnded` and `divergences()` are skipped by
  construction (the runtime check in `onTurn`; `usage_entries` come only from Claude transcripts).
- **`SessionManagerOptions` keeps `runtime` plus `opencode`** rather than a `runtimes` map: there are two runtimes.

The kill check (by hand, 2026-11-05, Sonnet on the Pi): an OpenCode session ran an approved `sleep 287`; the daemon
stopped with SIGTERM left no `sleep` and no `opencode acp` behind. Killed with SIGKILL, `opencode acp` exited when its
stdin closed but the `sleep` it started survived (an orphan in its own process group), as any child of a killed process
does. Under the systemd service the unit's control group is cleaned when it stops or restarts. Proposed for phase 40: a pid
ledger of OpenCode process groups in the data folder, reaped at the next start.
