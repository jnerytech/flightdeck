# The workflow verbs that write: trust, template-add and resume --confirm (issue #3628)

## Context

The read side of `flightdeckd workflow` shipped in #3747. Three daemon requests still had only the app as a client:
`workflow.trust` (lets a workflow's shell commands run on the host), `workflow.template.add` (commits a template on
a new branch and opens its PR) and `run.resume` with `confirm` (runs the project's commands again from the failed
step). Under CLI first (#3423) each needs a verb.

## Decision

1. `workflow trust <project> <workflow> --hash <hash>` sends `workflow.trust`. The hash is the whole sha256 that
   `workflow list` prints, 64 hex characters; the parser refuses a prefix, because the daemon compares all of it and
   a prefix would always read as "changed". The CLI never reads a hash for the person.
2. `workflow template-add <project> <template> [--confirm]` and `workflow resume <run> --confirm` send `confirm`
   only when the flag is typed. The daemon refuses without it and over a far connection (`requireVaultTransport`);
   the CLI shows the daemon's refusal and exits 1. `resume` without `--confirm` stays the check.
3. All three are high risk from a session's shell (`workflow-risk.ts`, one test per rule). `--hash` and
   `--confirm` are only the caller's word (limit #3439), so the rule is what makes the person answer. A resume
   whose flag the shell expands counts as `--confirm`.
4. A connection lost while a write is in flight exits 2 with "may or may not", and says how to look before running
   it again; `trust` is the only verb safe to repeat.
5. The parity rows of the three requests are `{ "cli": "workflow" }`. `gate.respond` stays app-only.

## Discarded

- Reading the hash for the person (`trust` without `--hash`): that would make the command trust whatever is on the
  branch now, which is what the hash exists to prevent.
- Treating `--confirm` on `trust`: the app asks for the hash, not a second confirm, so the parser refuses the flag.

## Consequences

- A flag before the verb (`workflow --json list api`) is still refused, as for the other nouns.
- Over `--host`, the `resume` check reports `transport_refused` as its reason, while `resume --confirm` and `template-add`
  are refused with an error (exit 1, the daemon's text); run them on the host.
- The shell rule reads the words, not the file: a script that runs the verb is rated by the script's own line.
