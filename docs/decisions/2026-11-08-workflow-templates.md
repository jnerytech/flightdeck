# Workflow templates are files to copy and commit (issue #79)

Issue #79 asks for ready-made workflows for recurring agent work. The first slice ships two of the
three proposed (the alert fixer and the post-mortem draft) and a read-only view of them.

- **A template is a file, and the host never writes to the base branch.** Workflows are read from
  the base branch only, and trust is given to one exact content (its hash). A daemon that wrote the
  file would put a workflow in front of the trust screen on its own. So the Workflows screen shows
  the file, copies it, and says where to commit it. Opening a pull request with the file is a later
  option, and it is a write to the repository that needs the security reviewer.
- **The check line takes the project's test command when it is a plain form.** The daemon asks for
  the project's stack (issue #75) and puts `commands.test` in the alert fixer's `check` only when it
  matches `^\w[\w .:/=@-]{0,79}$`, since the line ends up in a shell the person trusts. Anything else,
  and a project whose command is unknown, leaves a placeholder that fails on purpose
  (`... && false`), so a file nobody edited stops at the first run instead of passing.
- **Every template asks before it pushes.** Each has a `gate` right before its `pr` step, a budget
  of turns and minutes, and no `parallel` fan-out of agents. A test fails when a shipped template
  breaks one of these.
- **The tech-debt scan waits for the `cards` step.** It needs a daemon step that turns the agent's
  findings into Backlog cards, with a cap per run and a dedupe key. That step takes untrusted agent
  output into the board and goes to the security reviewer, so the scan ships with it (slice 2), not
  as a file the engine cannot run today. The agent is not given `create_card`.
- **Alerts are read by the daemon, later.** The alert fixer takes the alert as text for now. A
  later slice reads code-scanning and Dependabot alerts with a read-only `gh api` call by the daemon,
  so the agent sessions get no network.
