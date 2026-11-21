# The host's switches from the command line (issue #3699)

## Context

Under CLI first (#3423) every screen action is a `flightdeckd` command first. The read side of `host` and
`resources` shipped earlier. Seven daemon commands that change the host had no verb: `host.sleep`,
`host.keepAwake`, `host.pause`, `host.updates.set`, `host.bypass`, `resources.setPauseAt` and
`resources.endOrphan`. Two of them decide what a session may do: `host.bypass` with `allow: true` lets every session
run without permission prompts (it needs `confirm: true`, and a signed proof when a device is enrolled, see
`2026-11-20-host-command-proof.md`), and `host.updates.set` with `auto: true` lets the daemon install a version and
restart itself.

## Decision

1. The verbs are `fd host sleep <0-1440>`, `fd host keep-awake|pause|updates|bypass on|off`,
   `fd resources pause-at <0-1|off>` and `fd resources end-orphan <pid> <start-ticks>`. A bare `host` or
   `resources` still reads. The parser refuses a bad word before anything is sent (exit 1); numbers are plain
   digits, so `1e2`, `0x10` and a space are refused.
2. `bypass on` needs `--confirm`, which is only the caller's own word (limit #3439). A host with a device enrolled
   refuses with `approval_proof_required`; the command says to turn it on in the app and exits 1. The CLI never
   asks for or sends a proof, and a retry would be refused the same way. `bypass off` is open on the daemon and
   needs no flag. `--confirm` on any other verb of `host` is refused by the parser.
3. Every verb prints what the host keeps now (the daemon's answer), or the same object with `--json`. A connection
   lost while a write is in flight exits 2 and says the setting may or may not have changed; all seven are safe
   to repeat, and `end-orphan` is guarded by the pid and its start ticks.
4. The shell risk rules rate `host bypass on`, `host updates on` and `resources end-orphan` high. For the two
   switches only the word `off` is ordinary: a missing word, or one the shell expands, could be `on`.
   `sleep`, `keep-awake`, `pause`, `resources pause-at` and the `off` directions stay ordinary. `host` and
   `resources` join the nouns whose verb the rules read, so a verb the shell expands is high.
5. `host.updates.set` stays on the transport check only, as before; this change adds no gate to the daemon.

## Discarded

- A restart verb: `daemon.shutdown` is out of scope, and a daemon cannot report an answer for its own restart.
- Making `host pause on` and `host keep-awake` high: they change how the host waits, undo with one command and
  grant nothing.
- Prompting on a terminal for `bypass on`: the daemon already asks for `confirm` and the proof, and a prompt
  adds a path a script cannot use.

## Consequences

- The parity table has no gap for these seven commands (`host.bypass` is covered by `host`).
- A session on a host with a device enrolled cannot turn bypass on at all, even with `--confirm`; with none enrolled
  the risk rule is the only guard, and it stops the line before it runs.
- `args.ts` needed room: the `quota` handler moved to `quota-args.ts` first, in its own structure-only commit.
