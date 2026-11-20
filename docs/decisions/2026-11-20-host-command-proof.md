# Three host commands that widen what a session can do take the device proof; four stay as they are (issue #3507)

Parent: #3423. Builds on the device proof of #3439 and on the command gate that #3453 decides (the record of
PR #3508, `2026-11-20-command-approval-proof.md` once it is in `main`). Nothing here changes code: it decides
which of seven host commands join that gate, and says why the others do not. What it takes from #3453 is
stated where it is used: a command is gated by a list and a predicate that fails closed, and the proof is
asked only when a key is enrolled. `project.trust.set { trusted: true }` is #3453's own and already gated
there; it is not decided again here.

## Context

`requireVaultTransport` (`apps/daemon/src/vault/vault.ts`) accepts loopback (`127.0.0.0/8`, `::1/128`) and
the Tailscale ranges. A Claude Code session is a process on the host, so its connection to the daemon is
loopback and passes, and the daemon token sits in `~/.flightdeck/config.json`, which the same user can read.
So for a session, "near only" keeps nothing out. The transport check only keeps out a far connection that
holds the token.

The user's rule (2026-11-19): sessions start in `bypassPermissions` by default, and the person may turn that
off per host. `allowBypassPermissions` defaults to `true` (`apps/daemon/src/config.ts`). The question is
therefore not whether bypass should be on, but whether a session may turn back on what the person turned off,
and whether it may widen the host in other ways that no later prompt would catch.

The criterion used below is the one of #3453: a command takes the proof when it widens what a session may do
on the host, or makes the host run something the person did not approve, and a session can send it through
the daemon's own door. A command that only narrows, or that only moves a signed artifact, does not.

## What each command does, read on origin/main

| Command | Guard today | Effect | Widens? |
| --- | --- | --- | --- |
| `host.bypass { allow, confirm }` | transport; `allow: true` needs `confirm: true` (`bypass_confirm`) | writes `allowBypassPermissions` to the config file and in memory; new sessions may start without permission prompts | `true` widens, `false` narrows |
| `host.updates.set { auto }` | transport, no `confirm` | `auto: true` lets the host download and run a new release by itself | `true`: runs a new, signed binary unasked; `false` narrows |
| `roots.add { path, confirm }` | transport; `confirm: true` (`root_confirm`) | adds a folder where sessions may be created | widens only (there is no remove command) |
| `project.harness.apply { path, parts, digests, ... confirm }` | transport; `confirm: true` (`harness_confirm`) | writes the project's Claude Code setup, hooks included; a hook "runs its command in every session of a trusted project" | widens: code that runs in sessions |
| `project.harness.commit { path, digests, confirm }` | transport; `confirm: true` | makes a branch with the setup in the person's repository; it pushes nothing | no: a local branch the person reviews |
| `daemon.update.apply { confirm }` | `confirm: true` (`update_confirm`), no transport check | downloads the manifest's asset, checks sha256 and the project's minisign signature, hands it to the update | no: the caller chooses nothing |
| `service.install { confirm }` | `confirm: true` (`service_confirm`), no transport check | installs and enables the service for the next boot or login | no, see below |

`daemon.shutdown` had no guard at all (no confirm, no transport check) when this record was written; it now takes `confirm: true`. It is separate from the seven and is
answered below because it is the door the config-edit path uses.

## Decision

Recommendation: the three that widen join the command gate when a key is enrolled; the other four stay as
they are. With no key enrolled nothing changes, as for every command of the gate.

| Command | Answer |
| --- | --- |
| `host.bypass` | takes the proof when `allow` is `true`; `allow: false` stays open, with no `confirm`, as today |
| `host.updates.set` | stays on the transport check; `auto: true` is not gated, see below |
| `roots.add` | takes the proof |
| `project.harness.apply` | takes the proof |
| `project.harness.commit` | stays on transport and `confirm: true` |
| `daemon.update.apply` | stays on `confirm: true`, no transport check added |
| `service.install` | stays on `confirm: true`, no transport check added |
| `daemon.shutdown` (not one of the seven) | takes `confirm: true` only, no proof and no transport check (amended 2026-11-20 by fd-coordinator) |

The predicate follows the one of #3453: fail closed, a payload is gated unless its field is the narrowing
value (`allow === false`). The gate reads the payload after the schema (`allow` is a required boolean in
`packages/protocol/src/host.ts`), and tests `allow !== false`, never the truthiness the handler uses, so a
coerced or odd value is never read as the narrowing one.

### Why these three

- **`host.bypass { allow: true }` is the keystone.** Under bypass most requests are never asked, so the gate
  of #3439 has nothing left to check. If a session can turn bypass back on over loopback with a `confirm: true`
  it types itself, the person's choice to turn it off holds only until a session undoes it. With a key
  enrolled, the proof says the person did it.
- **`roots.add`.** A root decides where sessions may be created and which folders count as projects. A
  session that adds a folder such as `/srv`, or another user's projects, widens every later folder check
  (`resolveAllowedCwd`) at once. A filesystem root, the home folder and the system folders are already refused
  (`root_system`, `projects/domain/system-folders.ts`), so the dialog shows the one folder that was not.
- **`project.harness.apply`.** What it writes (a hook) runs as a command in every session of a trusted
  project, outside any permission prompt. That is code execution that the person did not approve in a
  prompt. The signed payload is the whole request (the path, the parts, the digests, `reformat`, the
  template), and the apply already ignores any content the app sends (it reads the template again). The digests
  mean nothing to a person, so the dialog line says what is dangerous instead: the folder, whether the
  settings or hooks part is in, the template's id, and the first line of each hook command when it is cheap to
  read. A session can pick the parts and template through `project.harness.preview`, so a dialog that said
  only "write settings to F" would hide the hook.
- **`project.trust.set { trusted: true }` is the other half of `apply`**: a session could write a hook, then
  trust its own project, and the hook runs unasked in every later run. It is already gated by #3453
  (predicate `trusted !== false`), so the two together close that route. The order of the PRs keeps `apply`
  from shipping before it.

### Why the other four stay

- **`host.updates.set { auto: true }` and `daemon.update.apply`** are one case. The release is signed (minisign
  and sha256, `apps/daemon/src/updates/apply.ts`, `domain/signature.ts`), the caller chooses nothing, and
  nothing is widened: the host replaces its own binary with one the project published. The manual door
  (`daemon.update.apply`) does it at once, which is the stronger of the two, so gating `auto: true` alone
  would leave the same act open beside it, and gating both costs two dialogs for a restart the person can
  always follow with the app's own update button. The harm that is left is a restart at a bad moment. That is
  made worse by one fact the review found: the handler passes no `proceed`, so the host-busy check of
  `updates/apply.ts` never runs and a session can restart a host while runs are going. That is a bug of its
  own, not a question of proof; the record names it for the specifier (a `fix(updates)` issue that makes the
  handler pass the check). `host.updates.set` keeps its transport check.
- **`project.harness.commit`** makes a local branch in the person's repository and pushes nothing. What it
  commits is what `apply` wrote, and `apply` is gated. A session can already run `git commit` on its own
  branch. It keeps `requireVaultTransport` and `confirm: true`.
- **A transport check for `daemon.update.apply`** is a candidate, and it is left out on purpose: the app calls this command for any host it reaches (`features/hosts/wire.ts`),
  including one over a network outside `VAULT_NETWORKS`, and a check there would take the update button from
  those hosts to keep out a connection that gains a restart. If the person wants the restart gated, it is a
  one-line addition to the list later.
- **`service.install`** adds persistence, and a session can run `flightdeckd service install` itself as the
  same user. The proof would close the protocol door and leave the shell one open, for a command whose result
  is that the daemon starts at login. It also installs only the stable binary (`appCanInstallService`), so it
  cannot point the service at something else. It also records the path of `claude` in the config
  (`claude.executablePath`, through `recordClaude`), which a session can edit itself.

### `daemon.shutdown`

It ends the daemon, and an installed service restarts it. The config-edit path of the next section ends with
it, but a session with a shell can `kill` the daemon anyway. A far token holder gains a restart on a host with
a service and a stopped daemon on one without: a denial of service, not a capability. It does not take the
proof and gets no transport check, because nothing is widened. It was the one command of the group with no
guard at all, though, and every neighbour that restarts or changes the host asks for `confirm: true`
(`daemon.update.apply`, `service.install`, `host.bypass`). It now does too (amended on 2026-11-20): the handler
refuses a payload without `confirm: true` with `invalid_state` and the reason `shutdown_confirm`, after the
`featureOff` check. The field is optional on the wire, so the schema stays additive (`protocol.md`), and the
refusal is the daemon's. `flightdeckd host stop` and the service update (`requestShutdown` in
`service/update.ts`) send it. The app has no caller of this command today; a screen that adds one sends
`confirm: true` after its own question.

What an older caller does: a `flightdeckd` older than this change sends `{}` to a new daemon and is refused
with `shutdown_confirm`; a newer one sends `{ confirm: true }` to an older daemon, whose schema is strict and
refuses the payload. In both cases `requestShutdown` answers false and the stop falls back to ending the
service's task or unit and the lock, as it already does for a daemon that is not there, so no host is left
unstoppable. What is lost in that window is the graceful stop: on Windows the fallback waits on the lock and
then kills the process that runs the service's binary, so sessions and the database close less cleanly. It lasts
only while the CLI and the running daemon are of different versions.

## What it does not stop

The limit that #3439 states holds here. A session on the host can edit `~/.flightdeck/config.json`
(`allowBypassPermissions`, `allowedRoots`, the auto-update setting), then end the daemon with `daemon.shutdown`
so that the service restarts with the new file (when a service is installed; a daemon run from source just stops,
and `daemon.shutdown` is refused with `featureOff` when the host gave no shutdown hook). The proof stops the protocol path, the app's own door, and not
the machine. It is still worth its cost for two reasons: a holder of the token without a shell (a leaked
token, a far connection, a compromised client of the daemon) has only that door, and the person sees a
dialog for every change that reaches the host through it, so a change made through the file stands out as one
that never had a dialog. The same holds for `project.harness.apply`: a session can write `.claude/settings.json` in its own project
directly, so gating the command stops the protocol door only. What the gate adds there is that the trust
that makes a hook run is stored outside the project files, behind `project.trust.set`, which is gated too.
The record does not claim more than that.

Out of scope, not classified here: the other commands that take a transport check, a `confirm`, both or
neither (`host.pause` has neither; `watch.settings` and `ssh.connect` check the transport only in some cases;
`ui.set` has a `confirm` and no transport check; `resources.endOrphan`, `harness.templates.delete`,
`project.harness.export`, `project.harness.draft`, `workflow.template.add`, `run.resume`, `card.checkLoop`,
`card.review` and `changes.commit` take both). Two of them deserve a second look by the criterion:
`changes.pr` (a push and a public pull request) and `watch.settings` (it makes the host run unattended). The
security review of this record found more that meet the criterion and are not classified here, each guarded by
`confirm` only or by nothing, with no transport check: `terminal.settings { enabled: true }` (a full shell on
the host; `terminal.open` has no transport check either), `mcp.save` and `mcp.toggle` (an MCP server's command
in a project's `.mcp.json`), `agentcfg.write` (agents and skills) and `hooks.uninstall` (it removes the hooks
that route permissions). This record decides the seven and gates three of them, and it does not claim a
session has no other way to run code: the gate closes one door of several. Each of these is a one-line
addition to the list if a later review says it widens; the specifier files that classification as its own
issue, with `terminal.settings` and `mcp.save` first.

## The app and the CLI

- The command gate and its dialog are built in the PRs of #3453 (a nonce purpose `command`, one signed
  message that binds the command name and the hash of the payload, `TAG_COMMAND` in the Rust signer). The three
  commands here add rows to its list and one display line each in the dialog: the host's name and the new
  value for `host.bypass`, the folder for `roots.add`, the folder, the parts, the template and the hook
  commands for `project.harness.apply`. A field with no line is listed as fixed, as the record of #3453 says.
- The CLI: none of the three has a verb today. When a slice adds one, it follows the rule of #3453: with a key
  enrolled the verb sends no proof, is refused, and says that the person must use the app; its
  `docs/cli-parity.json` row is `appOnly` with that reason. `host bypass off` is the
  narrowing value and keeps working.

## Options considered

- **A. Three join the gate, four stay (chosen).** One criterion, applied to every row. Cost: three more rows
  and display lines in a gate that is built anyway.
- **B. All seven join the gate (the coordinator's first brief).** Simple to say. Costs a dialog for
  `host.updates.set`, `daemon.update.apply` and `service.install`, which widen nothing (the first two move a
  signed release, the third leaves a shell door open), and for the commit that only makes a local branch.
  Rejected for those four; if the person wants the update gated, it is two list rows and one display line.
- **C. Add a stricter transport instead (loopback only, no Tailscale).** A session is on loopback, so it
  keeps out nobody who matters, and it breaks every host the app reaches over Tailscale. Rejected.
- **D. Leave all on `confirm: true`.** A session types `confirm: true` itself, so nothing is asked of
  anyone. It is today's state, and the reason for the issue. Rejected.

## Consequences

- With a key enrolled, a session cannot turn bypass back on, add a root or write
  a hook for the sessions through the daemon, and each of the three needs a dialog the person answers.
- Turning bypass off, or the four commands that stay, work as today. A session can
  still turn off what the person turned on: a nuisance, not a widening.
- The follow-up work is one issue per command or group (the specifier opens them, in the format of
  `docs/issue-format.md`), each after the command gate of #3453 is in `main`, test first, with the app's step
  and both manual languages: (1) `host.bypass`, (2) `roots.add`, (3) `project.harness.apply` (after the trust
  command of #3453), and a `fix(updates)` issue: `daemon.update.apply` passes no `proceed`, so a session
  restarts a busy host.
- A host with a key that announces the gate protects these three; a host that does not (an older daemon) shows
  the per-command notice that #3453 adds.

## Built: `host.bypass` (#3507, step 1)

- The host announces `approval-bypass` (`FEATURE_APPROVAL_BYPASS`) when it has an approvers store. With a key
  enrolled, `host.bypass { allow: true, confirm: true }` takes a proof over exactly that payload; `allow: false`
  stays open. The handler checks `confirm` first, so an unconfirmed request does not burn the challenge.
- `commandNeedsProof` gains one rule for both narrowing commands: `project.trust.set` is open for
  `trusted: false`, `host.bypass` for `allow: false`, and a missing or odd value is gated.
- The Rust signer reads only a confirmed turn-on (exactly `allow` and `confirm`, both `true`); a turn-off is
  never signed. The dialog names the host and its buttons say "Turn on" and "Cancel".
- The app proves with `FEATURE_APPROVAL_BYPASS`, not `approval-command`: a host that checks merges but not
  the switch gets the plain payload, and its page shows a notice (`approvalDevices.bypassUnchecked`).
- There is no CLI verb for `host.bypass`; the parity row stays as it is. When a verb is added it follows the
  rule above.
- The gate guards the protocol path only. A host whose config file already says bypass is on (the default), or
  a person or process that edits the config file and restarts the daemon, gets bypass without a device: the
  proof stops a session from turning back on, over the protocol, what the person turned off.
