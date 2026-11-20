# Changing a project from a shell (issue #3515)

Slice 2 of the `project` noun: `project add`, `update`, `detect-provider`, `harness-draft` and `harness-export`, over
`project.add`, `project.update`, `project.detectProvider`, `project.harness.draft` and `project.harness.export`.
`harness-apply`, `harness-commit` and `trust-set` still have no command (they stay `{}` or app-only in
`docs/cli-parity.json`); a later verb for `trust.set` reuses the device-proof gate of #3453 and adds no second path.

- `add` and `harness-draft` and `harness-export` take a folder; the handlers already resolve it with `resolveAllowedCwd`,
  so a folder outside the allowed roots is refused with `forbidden_cwd`. The CLI makes the folder absolute against the
  shell's folder; with `--host` it must already be absolute.
- `update` and `detect-provider` name a project the way `card` does (a name or an id; two projects with one name are
  refused with their ids), then send its id. An `update` that changes nothing is refused before it is sent, so a typo
  in a flag never looks like a success.
- Fields: `--name`, `--base-branch`, `--pr-provider`, `--setup-script` (`none` removes it), `--prompt-template` and
  `--auto-approve on|off` for both; `--default-hours` (`none` removes it) and `--persona-subagents` for `update` only,
  as the protocol has no such field on `add`. Left out of this slice: the issues integration, the persona and
  contract per column, and the value signals. They are objects the app edits on screens, and a flag for each would
  invent a syntax before a person needs it.
- Risk: `project add`, `update`, `harness-draft` and `harness-export` are high-risk shell commands
  (`permissions/domain/risk.ts`). A setup script is a shell command that runs in every card, `--auto-approve` changes
  what is approved without asking, `harness-export` copies instructions into the host's shared store and
  `harness-draft` is a model call. `detect-provider` and the read verbs stay ordinary commands.
- `add` and `update` are writes: a call that got no answer exits 2 and says it may or may not have happened.
